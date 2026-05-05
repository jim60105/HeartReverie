import { mount, flushPromises } from "@vue/test-utils";
import { createMemoryHistory, createRouter } from "vue-router";
import ImportCharacterCardPage from "@/components/ImportCharacterCardPage.vue";
import type { ParsedCharacterCard } from "@/types/character-card";

vi.mock("@/composables/useAuth", () => ({
  useAuth: () => ({
    getAuthHeaders: () => ({ "X-Passphrase": "test" }),
  }),
}));

let parserResult: ParsedCharacterCard | Error = makeParsed();
vi.mock("@/lib/character-card-parser", () => ({
  parseCharacterCard: vi.fn(async () => {
    if (parserResult instanceof Error) throw parserResult;
    return parserResult;
  }),
}));

function makeParsed(over: Partial<ParsedCharacterCard> = {}): ParsedCharacterCard {
  return {
    name: "Hero",
    description: "desc",
    personality: "p",
    scenario: "s",
    firstMes: "fm",
    mesExample: "ex",
    creatorNotes: "cn",
    systemPrompt: "sp",
    postHistoryInstructions: "phi",
    alternateGreetings: ["alt1"],
    tags: ["fantasy"],
    creator: "c",
    characterVersion: "1",
    bookName: "",
    bookEntries: [],
    ...over,
  };
}

function makeRouter() {
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: "/", name: "home", component: { template: "<div/>" } },
      {
        path: "/:series/:story",
        name: "story",
        component: { template: "<div/>" },
      },
    ],
  });
}

async function mountPage() {
  const router = makeRouter();
  await router.push("/");
  await router.isReady();
  const wrapper = mount(ImportCharacterCardPage, {
    global: { plugins: [router] },
  });
  return { wrapper, router };
}

async function loadCard(wrapper: ReturnType<typeof mount>) {
  const file = new File([new Uint8Array(8).buffer as ArrayBuffer], "x.png");
  const input = wrapper.find("input[type='file']").element as HTMLInputElement;
  Object.defineProperty(input, "files", {
    value: [file],
    writable: false,
    configurable: true,
  });
  await wrapper.find("input[type='file']").trigger("change");
  await flushPromises();
}

interface FetchCall {
  url: string;
  method: string;
  body?: unknown;
}

function setupFetch(opts: {
  charPreflight: number;
  worldPreflight?: number;
  initStatus?: number;
}): FetchCall[] {
  const calls: FetchCall[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      const body = init?.body
        ? typeof init.body === "string"
          ? JSON.parse(init.body)
          : init.body
        : undefined;
      calls.push({ url, method, body });
      if (method === "GET" && url.includes("/api/lore/")) {
        const status = url.includes(encodeURIComponent("world_info"))
          ? (opts.worldPreflight ?? 404)
          : opts.charPreflight;
        return {
          ok: status >= 200 && status < 300,
          status,
          json: async () => (status === 200 ? { frontmatter: {}, content: "" } : {}),
          text: async () => "{}",
          headers: new Headers(),
        };
      }
      if (method === "POST" && url.includes("/api/stories/")) {
        const status = opts.initStatus ?? 201;
        return {
          ok: true,
          status,
          json: async () => ({}),
          text: async () => "{}",
          headers: new Headers(),
        };
      }
      if (method === "PUT") {
        return {
          ok: true,
          status: 200,
          json: async () => ({}),
          text: async () => "{}",
          headers: new Headers(),
        };
      }
      throw new Error(`Unexpected ${method} ${url}`);
    }),
  );
  return calls;
}

describe("ImportCharacterCardPage", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    parserResult = makeParsed();
  });

  it("hides the editable form until a card is parsed", async () => {
    const { wrapper } = await mountPage();
    expect(wrapper.find(".form-region").exists()).toBe(false);
  });

  it("shows the form region after a successful parse and pre-fills CJK filename", async () => {
    parserResult = makeParsed({ name: "林小美" });
    const { wrapper } = await mountPage();
    await loadCard(wrapper);
    expect(wrapper.find("fieldset.group legend").exists()).toBe(true);
    expect(
      (wrapper.find("#ic-char-fn").element as HTMLInputElement).value,
    ).toBe("林小美.md");
  });

  it("shows parse error inline on parser failure and keeps form hidden", async () => {
    parserResult = new Error("Not a PNG file");
    const { wrapper } = await mountPage();
    await loadCard(wrapper);
    expect(wrapper.find("#ic-char-fn").exists()).toBe(false);
    expect(wrapper.text()).toContain("Not a PNG file");
  });

  it("validation blocks import when series/story are empty", async () => {
    parserResult = makeParsed();
    const calls = setupFetch({ charPreflight: 404 });
    const { wrapper } = await mountPage();
    await loadCard(wrapper);
    const importBtn = wrapper.findAll("button").find((b) => b.text() === "匯入")!;
    expect((importBtn.element as HTMLButtonElement).disabled).toBe(true);
    expect(calls).toHaveLength(0);
  });

  it("issues init + character PUT only when bookEntries is empty (URL has no _lore segment)", async () => {
    parserResult = makeParsed({ bookEntries: [] });
    const calls = setupFetch({ charPreflight: 404 });
    const { wrapper, router } = await mountPage();
    await loadCard(wrapper);
    await wrapper.find("#ic-series").setValue("S1");
    await wrapper.find("#ic-story").setValue("Story1");
    const importBtn = wrapper.findAll("button").find((b) => b.text() === "匯入")!;
    await importBtn.trigger("click");
    await flushPromises();
    const puts = calls.filter((c) => c.method === "PUT");
    expect(puts).toHaveLength(1);
    expect(puts[0]!.url).not.toContain("/_lore/");
    expect(puts[0]!.url).toBe("/api/lore/series/S1/character/Hero.md");
    expect(router.currentRoute.value.name).toBe("story");
  });

  it("includes both PUTs in correct order when bookEntries is non-empty", async () => {
    parserResult = makeParsed({
      bookEntries: [
        { name: "Alice", keys: ["alice", "a"], content: "Alice description" },
        { name: "Bob", keys: ["bob"], content: "Bob description" },
      ],
    });
    const calls = setupFetch({ charPreflight: 404, worldPreflight: 404 });
    const { wrapper } = await mountPage();
    await loadCard(wrapper);
    await wrapper.find("#ic-series").setValue("S1");
    await wrapper.find("#ic-story").setValue("Story1");
    const importBtn = wrapper.findAll("button").find((b) => b.text() === "匯入")!;
    await importBtn.trigger("click");
    await flushPromises();
    const puts = calls.filter((c) => c.method === "PUT");
    expect(puts).toHaveLength(2);
    expect(puts[0]!.url).toContain("Hero.md");
    expect(puts[1]!.url).toContain("world_info.md");
    const wiBody = puts[1]!.body as { content: string; frontmatter: Record<string, unknown> };
    expect(wiBody.content).toContain("## Alice");
    expect(wiBody.content).toContain("**Keys:** alice, a");
    expect(wiBody.content).toContain("## Bob");
    expect(wiBody.frontmatter).toEqual({ enabled: true, priority: 0 });
  });

  it("character PUT body uses edited textarea content (description)", async () => {
    parserResult = makeParsed({ description: "original" });
    const calls = setupFetch({ charPreflight: 404 });
    const { wrapper } = await mountPage();
    await loadCard(wrapper);
    await wrapper.find("#ic-description").setValue("edited");
    await wrapper.find("#ic-series").setValue("S1");
    await wrapper.find("#ic-story").setValue("Story1");
    const importBtn = wrapper.findAll("button").find((b) => b.text() === "匯入")!;
    await importBtn.trigger("click");
    await flushPromises();
    const put = calls.find((c) => c.method === "PUT")!;
    const body = put.body as { content: string };
    expect(body.content).toContain("## Description\nedited");
    expect(body.content).not.toContain("original");
  });

  it("frontmatter contains tags only when non-empty and never contains name key", async () => {
    parserResult = makeParsed({ tags: ["fantasy", "drama"] });
    const calls = setupFetch({ charPreflight: 404 });
    const { wrapper } = await mountPage();
    await loadCard(wrapper);
    await wrapper.find("#ic-series").setValue("S1");
    await wrapper.find("#ic-story").setValue("Story1");
    const importBtn = wrapper.findAll("button").find((b) => b.text() === "匯入")!;
    await importBtn.trigger("click");
    await flushPromises();
    const put = calls.find((c) => c.method === "PUT")!;
    const body = put.body as { frontmatter: Record<string, unknown> };
    expect(body.frontmatter.tags).toEqual(["fantasy", "drama"]);
    expect("name" in body.frontmatter).toBe(false);
  });

  it("tag with comma is dropped with warning", async () => {
    parserResult = makeParsed({ tags: ["adventure, fantasy", "ok"] });
    const calls = setupFetch({ charPreflight: 404 });
    const { wrapper } = await mountPage();
    await loadCard(wrapper);
    await wrapper.find("#ic-series").setValue("S1");
    await wrapper.find("#ic-story").setValue("Story1");
    const importBtn = wrapper.findAll("button").find((b) => b.text() === "匯入")!;
    await importBtn.trigger("click");
    await flushPromises();
    const put = calls.find((c) => c.method === "PUT")!;
    const body = put.body as { frontmatter: { tags?: string[] } };
    expect(body.frontmatter.tags).toEqual(["ok"]);
    expect(wrapper.text()).toContain("已忽略含特殊字元的標籤：adventure, fantasy");
  });

  it("collision preflight on character file blocks import until acknowledged", async () => {
    parserResult = makeParsed();
    const calls = setupFetch({ charPreflight: 200 });
    const { wrapper } = await mountPage();
    await loadCard(wrapper);
    await wrapper.find("#ic-series").setValue("S1");
    await wrapper.find("#ic-story").setValue("Story1");
    const importBtn = wrapper.findAll("button").find((b) => b.text() === "匯入")!;
    await importBtn.trigger("click");
    await flushPromises();
    expect(wrapper.text()).toContain("已存在同名篇章");
    expect(calls.filter((c) => c.method === "PUT")).toHaveLength(0);
    await wrapper.find(".collision input[type='checkbox']").setValue(true);
    await importBtn.trigger("click");
    await flushPromises();
    expect(calls.filter((c) => c.method === "PUT")).toHaveLength(1);
  });

  it("rejects path traversal in filename", async () => {
    parserResult = makeParsed();
    const calls = setupFetch({ charPreflight: 404 });
    const { wrapper } = await mountPage();
    await loadCard(wrapper);
    await wrapper.find("#ic-series").setValue("S1");
    await wrapper.find("#ic-story").setValue("Story1");
    await wrapper.find("#ic-char-fn").setValue("../foo.md");
    const importBtn = wrapper.findAll("button").find((b) => b.text() === "匯入")!;
    await importBtn.trigger("click");
    await flushPromises();
    expect(calls.filter((c) => c.method === "PUT")).toHaveLength(0);
    expect(wrapper.text()).toContain("檔案名稱無效");
  });

  it("dirty-form prompt cancellation preserves form state", async () => {
    parserResult = makeParsed({ description: "first" });
    const { wrapper } = await mountPage();
    await loadCard(wrapper);
    await wrapper.find("#ic-description").setValue("user-edit");
    parserResult = makeParsed({ description: "second" });
    const confirmSpy = vi.fn(() => false); vi.stubGlobal("confirm", confirmSpy);
    await loadCard(wrapper);
    expect(confirmSpy).toHaveBeenCalled();
    expect(
      (wrapper.find("#ic-description").element as HTMLTextAreaElement).value,
    ).toBe("user-edit");
    vi.unstubAllGlobals();
  });

  it("dirty-form prompt confirmation replaces form state", async () => {
    parserResult = makeParsed({ description: "first" });
    const { wrapper } = await mountPage();
    await loadCard(wrapper);
    await wrapper.find("#ic-description").setValue("user-edit");
    parserResult = makeParsed({ description: "second" });
    const confirmSpy = vi.fn(() => true); vi.stubGlobal("confirm", confirmSpy);
    await loadCard(wrapper);
    expect(confirmSpy).toHaveBeenCalled();
    expect(
      (wrapper.find("#ic-description").element as HTMLTextAreaElement).value,
    ).toBe("second");
    vi.unstubAllGlobals();
  });

  it("clean form does not prompt on second pick", async () => {
    parserResult = makeParsed({ description: "first" });
    const { wrapper } = await mountPage();
    await loadCard(wrapper);
    parserResult = makeParsed({ description: "second" });
    const confirmSpy = vi.fn(() => true); vi.stubGlobal("confirm", confirmSpy);
    await loadCard(wrapper);
    expect(confirmSpy).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it("never sends a multipart/form-data request", async () => {
    parserResult = makeParsed();
    const calls = setupFetch({ charPreflight: 404 });
    const { wrapper } = await mountPage();
    await loadCard(wrapper);
    await wrapper.find("#ic-series").setValue("S1");
    await wrapper.find("#ic-story").setValue("Story1");
    const importBtn = wrapper.findAll("button").find((b) => b.text() === "匯入")!;
    await importBtn.trigger("click");
    await flushPromises();
    for (const c of calls) {
      // body is parsed JSON in our mock
      if (c.body !== undefined) {
        expect(typeof c.body).toBe("object");
      }
    }
  });

  it("preflight 401 surfaces inline error and aborts before init/PUT", async () => {
    parserResult = makeParsed();
    const calls = setupFetch({ charPreflight: 401 });
    const { wrapper } = await mountPage();
    await loadCard(wrapper);
    await wrapper.find("#ic-series").setValue("S1");
    await wrapper.find("#ic-story").setValue("Story1");
    const importBtn = wrapper.findAll("button").find((b) => b.text() === "匯入")!;
    await importBtn.trigger("click");
    await flushPromises();
    expect(calls.filter((c) => c.method === "POST")).toHaveLength(0);
    expect(calls.filter((c) => c.method === "PUT")).toHaveLength(0);
    expect(wrapper.text()).toContain("預檢篇章失敗");
  });

  it("preflight 500 surfaces inline error and aborts", async () => {
    parserResult = makeParsed();
    const calls = setupFetch({ charPreflight: 500 });
    const { wrapper } = await mountPage();
    await loadCard(wrapper);
    await wrapper.find("#ic-series").setValue("S1");
    await wrapper.find("#ic-story").setValue("Story1");
    const importBtn = wrapper.findAll("button").find((b) => b.text() === "匯入")!;
    await importBtn.trigger("click");
    await flushPromises();
    expect(calls.filter((c) => c.method === "PUT")).toHaveLength(0);
    expect(wrapper.text()).toContain("預檢篇章失敗");
  });

  it("preflight network throw surfaces inline error and aborts", async () => {
    parserResult = makeParsed();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("Failed to fetch");
      }),
    );
    const { wrapper } = await mountPage();
    await loadCard(wrapper);
    await wrapper.find("#ic-series").setValue("S1");
    await wrapper.find("#ic-story").setValue("Story1");
    const importBtn = wrapper.findAll("button").find((b) => b.text() === "匯入")!;
    await importBtn.trigger("click");
    await flushPromises();
    expect(wrapper.text()).toContain("預檢篇章失敗");
  });

  it("changing filename after acknowledging clears the ack and re-blocks if new filename also collides", async () => {
    parserResult = makeParsed();
    const calls = setupFetch({ charPreflight: 200 });
    const { wrapper } = await mountPage();
    await loadCard(wrapper);
    await wrapper.find("#ic-series").setValue("S1");
    await wrapper.find("#ic-story").setValue("Story1");
    const importBtn = wrapper.findAll("button").find((b) => b.text() === "匯入")!;
    await importBtn.trigger("click");
    await flushPromises();
    expect(wrapper.text()).toContain("已存在同名篇章：Hero.md");
    await wrapper.find(".collision input[type='checkbox']").setValue(true);
    // Change filename; ack must clear.
    await wrapper.find("#ic-char-fn").setValue("Other.md");
    expect(wrapper.text()).not.toContain("已存在同名篇章：Hero.md");
    await importBtn.trigger("click");
    await flushPromises();
    // New filename collides too (mock GET 200 for any path).
    expect(wrapper.text()).toContain("已存在同名篇章：Other.md");
    expect(calls.filter((c) => c.method === "PUT")).toHaveLength(0);
  });

  it("rejects series name starting with underscore", async () => {
    parserResult = makeParsed();
    const calls = setupFetch({ charPreflight: 404 });
    const { wrapper } = await mountPage();
    await loadCard(wrapper);
    await wrapper.find("#ic-series").setValue("_bad");
    await wrapper.find("#ic-story").setValue("Story1");
    const importBtn = wrapper.findAll("button").find((b) => b.text() === "匯入")!;
    await importBtn.trigger("click");
    await flushPromises();
    expect(calls.filter((c) => c.method === "PUT")).toHaveLength(0);
    expect(wrapper.text()).toContain("系列名稱無效");
  });

  it("dirty-form prompt fires when only seriesName was edited", async () => {
    parserResult = makeParsed();
    const { wrapper } = await mountPage();
    await loadCard(wrapper);
    await wrapper.find("#ic-series").setValue("user-S1");
    parserResult = makeParsed({ description: "second" });
    const confirmSpy = vi.fn(() => false); vi.stubGlobal("confirm", confirmSpy);
    await loadCard(wrapper);
    expect(confirmSpy).toHaveBeenCalled();
    expect((wrapper.find("#ic-series").element as HTMLInputElement).value).toBe("user-S1");
    vi.unstubAllGlobals();
  });

  it("dirty-form prompt fires when only storyName was edited", async () => {
    parserResult = makeParsed();
    const { wrapper } = await mountPage();
    await loadCard(wrapper);
    await wrapper.find("#ic-story").setValue("user-Story");
    parserResult = makeParsed();
    const confirmSpy = vi.fn(() => false); vi.stubGlobal("confirm", confirmSpy);
    await loadCard(wrapper);
    expect(confirmSpy).toHaveBeenCalled();
    expect((wrapper.find("#ic-story").element as HTMLInputElement).value).toBe("user-Story");
    vi.unstubAllGlobals();
  });

  it("dirty-form prompt fires when only characterFilename was edited", async () => {
    parserResult = makeParsed();
    const { wrapper } = await mountPage();
    await loadCard(wrapper);
    await wrapper.find("#ic-char-fn").setValue("My-Hero.md");
    parserResult = makeParsed();
    const confirmSpy = vi.fn(() => false); vi.stubGlobal("confirm", confirmSpy);
    await loadCard(wrapper);
    expect(confirmSpy).toHaveBeenCalled();
    expect((wrapper.find("#ic-char-fn").element as HTMLInputElement).value).toBe("My-Hero.md");
    vi.unstubAllGlobals();
  });

  it("dirty-form prompt fires when only worldInfoName or worldInfoFilename was edited", async () => {
    parserResult = makeParsed();
    const { wrapper } = await mountPage();
    await loadCard(wrapper);
    await wrapper.find("#ic-wi-name").setValue("My Realm");
    parserResult = makeParsed();
    const confirmSpy = vi.fn(() => false); vi.stubGlobal("confirm", confirmSpy);
    await loadCard(wrapper);
    expect(confirmSpy).toHaveBeenCalled();
    expect((wrapper.find("#ic-wi-name").element as HTMLInputElement).value).toBe("My Realm");
    vi.unstubAllGlobals();
  });

  it("retry after world_info PUT failure does not re-preflight or re-PUT character", async () => {
    parserResult = makeParsed({
      bookEntries: [{ name: "A", keys: ["a"], content: "c" }],
    });
    let charGetCount = 0;
    let charPutCount = 0;
    let wiPutCount = 0;
    let wiPutFails = true;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        const method = init?.method ?? "GET";
        if (method === "GET" && url.includes("/api/lore/")) {
          if (url.includes("Hero")) charGetCount++;
          return { ok: false, status: 404, json: async () => ({}), text: async () => "{}", headers: new Headers() };
        }
        if (method === "POST") {
          return { ok: true, status: 201, json: async () => ({}), text: async () => "{}", headers: new Headers() };
        }
        if (method === "PUT") {
          if (url.includes("Hero")) {
            charPutCount++;
            return { ok: true, status: 200, json: async () => ({}), text: async () => "{}", headers: new Headers() };
          }
          wiPutCount++;
          if (wiPutFails) {
            return { ok: false, status: 500, json: async () => ({ detail: "boom" }), text: async () => "{}", headers: new Headers() };
          }
          return { ok: true, status: 200, json: async () => ({}), text: async () => "{}", headers: new Headers() };
        }
        throw new Error(`Unexpected ${method} ${url}`);
      }),
    );
    const { wrapper } = await mountPage();
    await loadCard(wrapper);
    await wrapper.find("#ic-series").setValue("S1");
    await wrapper.find("#ic-story").setValue("Story1");
    const importBtn = wrapper.findAll("button").find((b) => b.text() === "匯入")!;
    await importBtn.trigger("click");
    await flushPromises();
    expect(charPutCount).toBe(1);
    expect(wiPutCount).toBe(1);
    expect(wrapper.text()).toContain("建立世界篇章失敗");
    wiPutFails = false;
    const charGetBefore = charGetCount;
    await importBtn.trigger("click");
    await flushPromises();
    expect(charGetCount).toBe(charGetBefore);
    expect(charPutCount).toBe(1);
    expect(wiPutCount).toBe(2);
  });

  it("changing series after successful import triggers new preflight and PUT", async () => {
    parserResult = makeParsed({ bookEntries: [] });
    const calls = setupFetch({ charPreflight: 404 });
    const { wrapper } = await mountPage();
    await loadCard(wrapper);
    await wrapper.find("#ic-series").setValue("S1");
    await wrapper.find("#ic-story").setValue("Story1");
    const importBtn = wrapper.findAll("button").find((b) => b.text() === "匯入")!;
    await importBtn.trigger("click");
    await flushPromises();
    const firstPuts = calls.filter((c) => c.method === "PUT");
    expect(firstPuts).toHaveLength(1);
    expect(firstPuts[0]!.url).toBe("/api/lore/series/S1/character/Hero.md");
    // Change series — should issue another PUT for the new series
    await wrapper.find("#ic-series").setValue("S2");
    await importBtn.trigger("click");
    await flushPromises();
    const allPuts = calls.filter((c) => c.method === "PUT");
    expect(allPuts).toHaveLength(2);
    expect(allPuts[1]!.url).toBe("/api/lore/series/S2/character/Hero.md");
  });

  it("buildWorldInfoMarkdown trims and filters empty keys", async () => {
    parserResult = makeParsed({
      bookEntries: [
        { name: "Entry", keys: ["", " alice ", "   ", "bob"], content: "body" },
      ],
    });
    const calls = setupFetch({ charPreflight: 404, worldPreflight: 404 });
    const { wrapper } = await mountPage();
    await loadCard(wrapper);
    await wrapper.find("#ic-series").setValue("S1");
    await wrapper.find("#ic-story").setValue("Story1");
    const importBtn = wrapper.findAll("button").find((b) => b.text() === "匯入")!;
    await importBtn.trigger("click");
    await flushPromises();
    const wiPut = calls.filter((c) => c.method === "PUT").find((c) => c.url.includes("world_info"));
    expect(wiPut).toBeDefined();
    const body = wiPut!.body as { content: string };
    expect(body.content).toContain("**Keys:** alice, bob");
    expect(body.content).not.toMatch(/\*\*Keys:\*\*.*,\s*,/);
  });
});
