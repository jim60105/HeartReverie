// Copyright (C) 2026 Jim Chen <Jim@ChenJ.im>, licensed under AGPL-3.0-or-later
//
// Tests for useChatInput() — the shared, story-aware chat-input singleton.

let mockSeries: string | null = "series-a";
let mockStory: string | null = "story-a";

vi.mock("@/composables/useChapterNav", () => ({
  useChapterNav: () => ({
    getBackendContext: () => ({
      series: mockSeries,
      story: mockStory,
      isBackendMode: mockSeries !== null && mockStory !== null,
    }),
  }),
}));

import { __resetChatInputForTests, useChatInput } from "@/composables/useChatInput";

function storageKey(series: string, story: string): string {
  return `heartreverie:chat-input:${series}:${story}`;
}

describe("useChatInput — shared singleton", () => {
  beforeEach(() => {
    sessionStorage.clear();
    mockSeries = "series-a";
    mockStory = "story-a";
    __resetChatInputForTests();
  });

  it("shares one inputText ref across two callers (live, without send)", () => {
    const a = useChatInput();
    const b = useChatInput();
    expect(a.inputText).toBe(b.inputText);

    a.inputText.value = "讓氣氛更陰鬱";
    expect(b.inputText.value).toBe("讓氣氛更陰鬱");
  });

  it("appendText prepends a newline only when non-empty", () => {
    const { inputText, appendText } = useChatInput();
    inputText.value = "";
    appendText("先回家");
    expect(inputText.value).toBe("先回家");
    appendText("走向藥妝店");
    expect(inputText.value).toBe("先回家\n走向藥妝店");
  });

  it("persistText writes to the active story's sessionStorage key", () => {
    const { persistText } = useChatInput();
    persistText("草稿內容");
    expect(sessionStorage.getItem(storageKey("series-a", "story-a"))).toBe("草稿內容");
  });

  it("syncToStory reseeds from the new story's persisted draft when the key changes", () => {
    sessionStorage.setItem(storageKey("series-b", "story-b"), "B 的草稿");
    const { inputText, syncToStory } = useChatInput();

    syncToStory("series-a", "story-a"); // seed A (empty)
    inputText.value = "A 的未送出文字";

    syncToStory("series-b", "story-b"); // switch to B
    expect(inputText.value).toBe("B 的草稿");
  });

  it("does NOT leak unsent text across a story switch (B has no stored draft)", () => {
    const { inputText, syncToStory } = useChatInput();

    syncToStory("series-a", "story-a");
    inputText.value = "讓氣氛更陰鬱"; // typed for A, never sent

    // Active story switches to B (no stored value).
    syncToStory("series-b", "story-b");

    expect(inputText.value).toBe(""); // observes B's empty value
    expect(inputText.value).not.toBe("讓氣氛更陰鬱");
  });

  it("syncToStory is a no-op for the same key (does not clobber typed text)", () => {
    const { inputText, syncToStory } = useChatInput();
    syncToStory("series-a", "story-a");
    inputText.value = "正在輸入";
    syncToStory("series-a", "story-a"); // same key
    expect(inputText.value).toBe("正在輸入");
  });
});
