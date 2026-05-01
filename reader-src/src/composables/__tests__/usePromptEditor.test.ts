// Copyright (C) 2026 Jim Chen <Jim@ChenJ.im>, licensed under AGPL-3.0-or-later
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU AFFERO GENERAL PUBLIC LICENSE as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU AFFERO GENERAL PUBLIC LICENSE for more details.
//
// You should have received a copy of the GNU AFFERO GENERAL PUBLIC LICENSE
// along with this program.  If not, see <https://www.gnu.org/licenses/>.

import { ref } from "vue";
import { stubSessionStorage } from "@/__tests__/setup";

const mockSelectedSeries = ref("");
const mockSelectedStory = ref("");

vi.mock("@/composables/useStorySelector", () => ({
  useStorySelector: () => ({
    selectedSeries: mockSelectedSeries,
    selectedStory: mockSelectedStory,
    seriesList: ref([]),
    storyList: ref([]),
    fetchSeries: vi.fn(),
    fetchStories: vi.fn(),
  }),
}));

const PARSEABLE = '{{ message "system" }}\nYou are helpful.\n{{ /message }}\n\n{{ message "user" }}\n{{ user_input }}\n{{ /message }}\n';
const LOSSY = 'preamble\n\n{{ message "system" }}\nS\n{{ /message }}\n\nbetween\n\n{{ message "user" }}\nU\n{{ /message }}\n';
const UNPARSEABLE = '{{ message "system" }}\nNo closer here\n';

interface FetchInit { method?: string; body?: string }
type FetchHandler = (
  url: string,
  init?: FetchInit,
) => Promise<{
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
  headers: Headers;
}>;

function makeFetch(opts: {
  content?: string;
  source?: "custom" | "default";
  putOk?: boolean;
} = {}): ReturnType<typeof vi.fn> {
  const { content = PARSEABLE, source = "default", putOk = true } = opts;
  const handler: FetchHandler = (url, init) => {
    if (typeof url === "string" && url.includes("/api/plugins/parameters")) {
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve([]),
        headers: new Headers(),
      });
    }
    const method = init?.method ?? "GET";
    if (method === "PUT") {
      if (!putOk) {
        return Promise.resolve({
          ok: false,
          status: 400,
          json: () => Promise.resolve({ detail: "boom" }),
          headers: new Headers(),
        });
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve({}),
        headers: new Headers(),
      });
    }
    if (method === "DELETE") {
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve({}),
        headers: new Headers(),
      });
    }
    if (typeof url === "string" && url.includes("/preview-prompt")) {
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ messages: [] }),
        headers: new Headers(),
      });
    }
    return Promise.resolve({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ content, source }),
      headers: new Headers(),
    });
  };
  const mock = vi.fn(handler);
  vi.stubGlobal("fetch", mock);
  return mock;
}

async function freshEditor() {
  const { usePromptEditor } = await import("@/composables/usePromptEditor");
  return usePromptEditor();
}

describe("usePromptEditor — load semantics", () => {
  beforeEach(() => {
    vi.resetModules();
    stubSessionStorage();
    mockSelectedSeries.value = "";
    mockSelectedStory.value = "";
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("happy-path load enters cards mode and populates originalCards/originalRawSource", async () => {
    makeFetch({ content: PARSEABLE });
    const e = await freshEditor();
    await e.loadTemplate();

    expect(e.mode.value).toBe("cards");
    expect(e.useRawFallback.value).toBe(false);
    expect(e.parseError.value).toBeNull();
    expect(e.cards.value.length).toBe(2);
    expect(e.cards.value[0]!.role).toBe("system");
    expect(e.cards.value[1]!.role).toBe("user");
    expect(e.originalRawSource.value).toBe(PARSEABLE);
    expect(e.isDirty.value).toBe(false);
    expect(e.topLevelContentDropped.value).toBe(false);
  });

  it("un-card-isable load enters raw mode with parseError set and originalRawSource preserved", async () => {
    makeFetch({ content: UNPARSEABLE });
    const e = await freshEditor();
    await e.loadTemplate();

    expect(e.mode.value).toBe("raw");
    expect(e.useRawFallback.value).toBe(true);
    expect(e.parseError.value).not.toBeNull();
    expect(e.rawSource.value).toBe(UNPARSEABLE);
    expect(e.originalRawSource.value).toBe(UNPARSEABLE);
    expect(e.isDirty.value).toBe(false);
  });

  it("lossy top-level drop sets topLevelContentDropped flag", async () => {
    makeFetch({ content: LOSSY });
    const e = await freshEditor();
    await e.loadTemplate();

    expect(e.mode.value).toBe("cards");
    expect(e.topLevelContentDropped.value).toBe(true);
    expect(e.cards.value.length).toBe(3); // preamble→system, system, user
    expect(e.cards.value[0]!.body).toBe("preamble");
  });
});

describe("usePromptEditor — dirty tracking", () => {
  beforeEach(() => {
    vi.resetModules();
    stubSessionStorage();
    mockSelectedSeries.value = "";
    mockSelectedStory.value = "";
  });
  afterEach(() => vi.unstubAllGlobals());

  it("editing a card body marks dirty; reverting restores clean", async () => {
    makeFetch({ content: PARSEABLE });
    const e = await freshEditor();
    await e.loadTemplate();
    const original = e.cards.value[1]!.body;
    e.cards.value[1]!.body = "edited";
    expect(e.isDirty.value).toBe(true);
    e.cards.value[1]!.body = original;
    expect(e.isDirty.value).toBe(false);
  });

  it("reordering cards counts as dirty", async () => {
    makeFetch({ content: PARSEABLE });
    const e = await freshEditor();
    await e.loadTemplate();
    e.moveCardUp(e.cards.value[1]!.id);
    expect(e.isDirty.value).toBe(true);
  });

  it("editing rawSource in raw mode marks dirty", async () => {
    makeFetch({ content: UNPARSEABLE });
    const e = await freshEditor();
    await e.loadTemplate();
    expect(e.isDirty.value).toBe(false);
    e.rawSource.value = UNPARSEABLE + "\n";
    expect(e.isDirty.value).toBe(true);
  });
});

describe("usePromptEditor — mode toggle", () => {
  beforeEach(() => {
    vi.resetModules();
    stubSessionStorage();
    mockSelectedSeries.value = "";
    mockSelectedStory.value = "";
  });
  afterEach(() => vi.unstubAllGlobals());

  it("cards → raw populates rawSource with serializeMessageCards(cards) and leaves originalRawSource untouched", async () => {
    makeFetch({ content: LOSSY });
    const e = await freshEditor();
    await e.loadTemplate();
    expect(e.topLevelContentDropped.value).toBe(true);

    e.toggleRawFallback();

    expect(e.mode.value).toBe("raw");
    // New semantics: textarea now reflects the lossy serialisation of the
    // current cards (NOT originalRawSource). originalRawSource stays as the
    // last-loaded baseline so dirty tracking remains correct.
    expect(e.rawSource.value).not.toBe(LOSSY);
    expect(e.rawSource.value).toContain('{{ message "system" }}');
    expect(e.originalRawSource.value).toBe(LOSSY);
    // Lossy serialisation differs from the lossless baseline → editor is dirty
    // (this is the structural change the warning banner already advertises).
    expect(e.isDirty.value).toBe(true);
  });

  it("raw → cards on parseable raw replaces cards but does NOT refresh originalRawSource", async () => {
    makeFetch({ content: PARSEABLE });
    const e = await freshEditor();
    await e.loadTemplate();
    e.toggleRawFallback();
    expect(e.mode.value).toBe("raw");
    const edited = '{{ message "user" }}\nhello\n{{ /message }}\n';
    e.rawSource.value = edited;
    e.toggleRawFallback();
    expect(e.mode.value).toBe("cards");
    expect(e.cards.value.length).toBe(1);
    expect(e.cards.value[0]!.role).toBe("user");
    // Baseline must remain the originally-loaded source — mode toggles never
    // mutate it.
    expect(e.originalRawSource.value).toBe(PARSEABLE);
    // Structural change → still dirty until saved.
    expect(e.isDirty.value).toBe(true);
    expect(e.parseError.value).toBeNull();
  });

  it("raw → cards on unparseable raw stays in raw and surfaces parseError", async () => {
    makeFetch({ content: PARSEABLE });
    const e = await freshEditor();
    await e.loadTemplate();
    e.toggleRawFallback();
    e.rawSource.value = '{{ message "user" }}\nbroken\n'; // missing closer
    e.toggleRawFallback();
    expect(e.mode.value).toBe("raw");
    expect(e.parseError.value).not.toBeNull();
  });

  it("dirty cards survive cards → raw → cards round-trip when raw text untouched (regression guard for round-trip preservation)", async () => {
    makeFetch({ content: PARSEABLE });
    const e = await freshEditor();
    await e.loadTemplate();
    expect(e.isDirty.value).toBe(false);

    // Edit a card body — composable goes dirty in cards mode.
    e.cards.value[1]!.body = "edited-body";
    expect(e.isDirty.value).toBe(true);

    // Round-trip through raw mode without modifying the textarea.
    e.toggleRawFallback();
    expect(e.mode.value).toBe("raw");
    e.toggleRawFallback();
    expect(e.mode.value).toBe("cards");

    // The pending edit MUST survive the round-trip.
    expect(e.cards.value[1]!.body).toBe("edited-body");
    expect(e.isDirty.value).toBe(true);
  });

  it("raw fix remains dirty after raw → cards parse and saves the edited raw text", async () => {
    const fetchMock = makeFetch({ content: UNPARSEABLE });
    const e = await freshEditor();
    await e.loadTemplate();

    // Composable enters raw fallback automatically.
    expect(e.mode.value).toBe("raw");
    expect(e.useRawFallback.value).toBe(true);

    // Edit raw to a parseable template.
    const fixed = '{{ message "user" }}\nfixed\n{{ /message }}\n';
    e.rawSource.value = fixed;

    // Toggle to cards: should re-parse since raw was modified relative to
    // (non-existent) round-trip snapshot.
    e.toggleRawFallback();
    expect(e.mode.value).toBe("cards");
    expect(e.cards.value.length).toBe(1);
    expect(e.cards.value[0]!.role).toBe("user");
    expect(e.cards.value[0]!.body).toBe("fixed");
    // Still dirty until saved.
    expect(e.isDirty.value).toBe(true);

    // Save now: must PUT the body matching the edited raw template.
    await e.save();
    const putCall = fetchMock.mock.calls.find(
      (c) => (c[1] as FetchInit | undefined)?.method === "PUT",
    );
    expect(putCall).toBeDefined();
    const sent = JSON.parse((putCall![1] as FetchInit).body!) as { content: string };
    expect(sent.content).toBe(fixed);
    expect(e.isDirty.value).toBe(false);
  });
});

describe("usePromptEditor — save", () => {
  beforeEach(() => {
    vi.resetModules();
    stubSessionStorage();
    mockSelectedSeries.value = "";
    mockSelectedStory.value = "";
  });
  afterEach(() => vi.unstubAllGlobals());

  it("save in cards mode PUTs serialised body and refreshes snapshots", async () => {
    const fetchMock = makeFetch({ content: PARSEABLE });
    const e = await freshEditor();
    await e.loadTemplate();
    e.cards.value[1]!.body = "edited";
    expect(e.isDirty.value).toBe(true);

    await e.save();

    const putCall = fetchMock.mock.calls.find(
      (c) => (c[1] as FetchInit | undefined)?.method === "PUT",
    );
    expect(putCall).toBeDefined();
    const sent = JSON.parse((putCall![1] as FetchInit).body!) as { content: string };
    expect(sent.content).toContain('{{ message "user" }}\nedited\n{{ /message }}');
    expect(e.isDirty.value).toBe(false);
    expect(e.originalRawSource.value).toBe(sent.content);
  });

  it("save in raw mode PUTs raw text directly and refreshes originalRawSource (regression guard)", async () => {
    const fetchMock = makeFetch({ content: UNPARSEABLE });
    const e = await freshEditor();
    await e.loadTemplate();
    expect(e.mode.value).toBe("raw");
    const newRaw = "free-form raw with {{> jsexpr }}";
    e.rawSource.value = newRaw;
    expect(e.isDirty.value).toBe(true);

    await e.save();

    const putCall = fetchMock.mock.calls.find(
      (c) => (c[1] as FetchInit | undefined)?.method === "PUT",
    );
    const sent = JSON.parse((putCall![1] as FetchInit).body!) as { content: string };
    expect(sent.content).toBe(newRaw);
    expect(e.originalRawSource.value).toBe(newRaw);
    expect(e.isDirty.value).toBe(false);
  });

  it("save throws fallback error detail when backend rejects", async () => {
    makeFetch({ content: PARSEABLE, putOk: false });
    const e = await freshEditor();
    await e.loadTemplate();
    e.cards.value[1]!.body = "x";
    await expect(e.save()).rejects.toThrow("boom");
  });

  it("pre-save validity guard blocks save when no user-role card and surfaces zh-TW reason", async () => {
    const fetchMock = makeFetch({
      content: '{{ message "system" }}\nonly system\n{{ /message }}\n',
    });
    const e = await freshEditor();
    await e.loadTemplate();
    expect(e.cards.value.every((c) => c.role !== "user")).toBe(true);
    e.cards.value[0]!.body = "modified";
    expect(e.saveDisabledReason.value).toBe(
      "請至少包含一則使用者訊息（傳送者：使用者）",
    );
    await expect(e.save()).rejects.toThrow(
      "請至少包含一則使用者訊息（傳送者：使用者）",
    );
    const putCall = fetchMock.mock.calls.find(
      (c) => (c[1] as FetchInit | undefined)?.method === "PUT",
    );
    expect(putCall).toBeUndefined();
  });

  it("pre-save validity guard reasons cover empty / empty-body / OK", async () => {
    makeFetch({ content: PARSEABLE });
    const e = await freshEditor();
    await e.loadTemplate();
    expect(e.saveDisabledReason.value).toBeNull();

    // empty cards
    e.cards.value.splice(0, e.cards.value.length);
    expect(e.saveDisabledReason.value).toBe("請至少新增一則訊息");

    // a single user card with empty body
    e.addCard();
    e.cards.value[0]!.role = "user";
    e.cards.value[0]!.body = "   ";
    expect(e.saveDisabledReason.value).toBe("請填入所有訊息的內容");

    // pass
    e.cards.value[0]!.body = "ok";
    expect(e.saveDisabledReason.value).toBeNull();
  });
});

describe("usePromptEditor — strip warning persistence & cross-mode regression", () => {
  beforeEach(() => {
    vi.resetModules();
    stubSessionStorage();
    mockSelectedSeries.value = "";
    mockSelectedStory.value = "";
  });
  afterEach(() => vi.unstubAllGlobals());

  it("persistent strip warning survives multiple edits and only clears on next successful Load", async () => {
    makeFetch({ content: LOSSY });
    const e = await freshEditor();
    await e.loadTemplate();
    expect(e.topLevelContentDropped.value).toBe(true);
    e.cards.value[0]!.body = "edited 1";
    expect(e.topLevelContentDropped.value).toBe(true);
    e.addCard();
    expect(e.topLevelContentDropped.value).toBe(true);
    // Reload with clean source clears the flag.
    makeFetch({ content: PARSEABLE });
    await e.loadTemplate();
    expect(e.topLevelContentDropped.value).toBe(false);
  });

  it("lossy load → save → snapshot equals current state (saved-event regression baseline)", async () => {
    makeFetch({ content: LOSSY });
    const e = await freshEditor();
    await e.loadTemplate();
    // ensure user-role card exists for the validity guard
    expect(e.cards.value.some((c) => c.role === "user")).toBe(true);
    e.cards.value[0]!.body = "fresh preamble";
    await e.save();
    expect(e.isDirty.value).toBe(false);
    // snapshot equals current (no-op edit now would mark clean)
    expect(e.saveDisabledReason.value).toBeNull();
  });
});

describe("usePromptEditor — card actions", () => {
  beforeEach(() => {
    vi.resetModules();
    stubSessionStorage();
    mockSelectedSeries.value = "";
    mockSelectedStory.value = "";
  });
  afterEach(() => vi.unstubAllGlobals());

  it("addCard appends a fresh system card with empty body and unique id", async () => {
    makeFetch({ content: PARSEABLE });
    const e = await freshEditor();
    await e.loadTemplate();
    const beforeLen = e.cards.value.length;
    e.addCard();
    expect(e.cards.value.length).toBe(beforeLen + 1);
    const last = e.cards.value[e.cards.value.length - 1]!;
    expect(last.role).toBe("system");
    expect(last.body).toBe("");
    expect(last.id).toBeTruthy();
    const ids = new Set(e.cards.value.map((c) => c.id));
    expect(ids.size).toBe(e.cards.value.length);
  });

  it("deleteCard removes by id", async () => {
    makeFetch({ content: PARSEABLE });
    const e = await freshEditor();
    await e.loadTemplate();
    const targetId = e.cards.value[0]!.id;
    e.deleteCard(targetId);
    expect(e.cards.value.find((c) => c.id === targetId)).toBeUndefined();
  });

  it("moveCardUp / moveCardDown swap and no-op at boundaries", async () => {
    makeFetch({ content: PARSEABLE });
    const e = await freshEditor();
    await e.loadTemplate();
    const ids = e.cards.value.map((c) => c.id);
    e.moveCardUp(ids[0]!); // no-op
    expect(e.cards.value.map((c) => c.id)).toEqual(ids);
    e.moveCardDown(ids[1]!); // no-op (last)
    expect(e.cards.value.map((c) => c.id)).toEqual(ids);
    e.moveCardDown(ids[0]!);
    expect(e.cards.value.map((c) => c.id)).toEqual([ids[1], ids[0]]);
    e.moveCardUp(ids[0]!);
    expect(e.cards.value.map((c) => c.id)).toEqual(ids);
  });
});

describe("usePromptEditor — preview & misc", () => {
  beforeEach(() => {
    vi.resetModules();
    stubSessionStorage();
    mockSelectedSeries.value = "";
    mockSelectedStory.value = "";
  });
  afterEach(() => vi.unstubAllGlobals());

  it("previewTemplate sends serialised template when dirty", async () => {
    const fetchMock = makeFetch({ content: PARSEABLE });
    const e = await freshEditor();
    await e.loadTemplate();
    e.cards.value[1]!.body = "dirty";
    const result = await e.previewTemplate("s", "t", "");
    expect(result).toEqual({ messages: [] });
    const previewCall = fetchMock.mock.calls.find((c) =>
      String(c[0]).includes("/preview-prompt")
    );
    const body = JSON.parse(
      (previewCall![1] as FetchInit).body!,
    ) as { message: string; template?: string };
    expect(body.message).toBe("(preview)");
    expect(body.template).toContain('{{ message "user" }}\ndirty\n{{ /message }}');
  });

  it("previewTemplate throws backend message on failure", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string, _init?: FetchInit) => {
        if (url.includes("/api/plugins/parameters")) {
          return Promise.resolve({
            ok: true, status: 200, json: () => Promise.resolve([]), headers: new Headers(),
          });
        }
        if (url.includes("/preview-prompt")) {
          return Promise.resolve({
            ok: false,
            status: 422,
            json: () => Promise.resolve({ message: "bad preview" }),
            headers: new Headers(),
          });
        }
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ content: PARSEABLE, source: "default" }),
          headers: new Headers(),
        });
      }),
    );
    const e = await freshEditor();
    await expect(e.previewTemplate("s", "t", "msg")).rejects.toThrow(
      "bad preview",
    );
  });

  it("dismissParseError clears the parseError ref", async () => {
    makeFetch({ content: UNPARSEABLE });
    const e = await freshEditor();
    await e.loadTemplate();
    expect(e.parseError.value).not.toBeNull();
    e.dismissParseError();
    expect(e.parseError.value).toBeNull();
  });

  it("does not reference localStorage", async () => {
    const ls = {
      getItem: vi.fn(),
      setItem: vi.fn(),
      removeItem: vi.fn(),
      clear: vi.fn(),
      length: 0,
      key: vi.fn(),
    };
    vi.stubGlobal("localStorage", ls);
    makeFetch({ content: PARSEABLE });
    const e = await freshEditor();
    await e.loadTemplate();
    e.cards.value[1]!.body = "new";
    await e.save();
    await e.resetTemplate();
    expect(ls.getItem).not.toHaveBeenCalled();
    expect(ls.setItem).not.toHaveBeenCalled();
    expect(ls.removeItem).not.toHaveBeenCalled();
  });

  it("resetTemplate calls DELETE then re-fetches via GET", async () => {
    const fetchMock = makeFetch({ content: PARSEABLE });
    const e = await freshEditor();
    await e.loadTemplate();
    const before = fetchMock.mock.calls.length;
    await e.resetTemplate();
    const after = fetchMock.mock.calls.slice(before);
    expect(after.some((c) => (c[1] as FetchInit | undefined)?.method === "DELETE")).toBe(true);
    expect(after.some((c) => {
      const m = (c[1] as FetchInit | undefined)?.method;
      return typeof c[0] === "string" && (c[0] as string).includes("/api/template") && (!m || m === "GET");
    })).toBe(true);
  });

  it("loadParameters re-fetches when story context changes", async () => {
    const fetchMock = makeFetch({ content: PARSEABLE });
    await freshEditor();
    const initial = fetchMock.mock.calls.filter((c) =>
      typeof c[0] === "string" && (c[0] as string).includes("/api/plugins/parameters")
    ).length;
    mockSelectedSeries.value = "series-a";
    mockSelectedStory.value = "story-b";
    await new Promise((r) => setTimeout(r, 50));
    const after = fetchMock.mock.calls.filter((c) =>
      typeof c[0] === "string" && (c[0] as string).includes("/api/plugins/parameters")
    ).length;
    expect(after).toBeGreaterThan(initial);
    const withParams = fetchMock.mock.calls.find((c) =>
      typeof c[0] === "string" && (c[0] as string).includes("series=series-a")
    );
    expect(withParams).toBeDefined();
  });
});
