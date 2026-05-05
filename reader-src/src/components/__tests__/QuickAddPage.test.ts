import { mount, flushPromises } from "@vue/test-utils";
import { createMemoryHistory, createRouter } from "vue-router";
import QuickAddPage from "@/components/QuickAddPage.vue";

vi.mock("@/composables/useAuth", () => ({
  useAuth: () => ({
    getAuthHeaders: () => ({ "X-Passphrase": "test" }),
  }),
}));

function makeRouter() {
  const router = createRouter({
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
  return router;
}

interface FetchCall {
  url: string;
  init?: RequestInit;
}

interface MockFetchResponse {
  status: number;
  body?: unknown;
}

function programmaticFetch(
  responses: Map<string, MockFetchResponse | ((url: string) => MockFetchResponse)>,
): { calls: FetchCall[]; spy: ReturnType<typeof vi.fn> } {
  const calls: FetchCall[] = [];
  const spy = vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    let resolver: MockFetchResponse | undefined;
    for (const [pattern, resp] of responses) {
      if (url.startsWith(pattern) || url === pattern) {
        resolver = typeof resp === "function" ? resp(url) : resp;
        break;
      }
    }
    if (!resolver) throw new Error(`Unmatched fetch URL in test: ${url}`);
    const status = resolver.status;
    return {
      ok: status >= 200 && status < 300,
      status,
      json: () => Promise.resolve(resolver!.body ?? {}),
      text: () =>
        Promise.resolve(
          typeof resolver!.body === "string"
            ? (resolver!.body as string)
            : JSON.stringify(resolver!.body ?? {}),
        ),
      headers: new Headers(),
    };
  });
  vi.stubGlobal("fetch", spy);
  return { calls, spy };
}

async function mountPage() {
  const router = makeRouter();
  await router.push("/");
  await router.isReady();
  const wrapper = mount(QuickAddPage, { global: { plugins: [router] } });
  return { wrapper, router };
}

describe("QuickAddPage", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("renders all eight controls with the correct Chinese labels", async () => {
    const { wrapper } = await mountPage();
    const labels = wrapper.findAll("label").map((l) => l.text());
    expect(labels).toEqual(
      expect.arrayContaining([
        "系列名稱",
        "故事名稱",
        "角色名稱",
        "角色檔案名稱",
        "角色設定內容",
        "世界篇章名稱",
        "世界篇章檔案名稱",
        "世界篇章內容",
      ]),
    );
  });

  it("disables the submit button when required fields are empty", async () => {
    const { wrapper } = await mountPage();
    const btn = wrapper.find("button[type='submit']");
    expect((btn.element as HTMLButtonElement).disabled).toBe(true);
    await wrapper.find("#qa-series").setValue("S1");
    expect((btn.element as HTMLButtonElement).disabled).toBe(true);
    await wrapper.find("#qa-story").setValue("Story1");
    expect((btn.element as HTMLButtonElement).disabled).toBe(false);
  });

  it("submits with story-init only when both lore groups are inactive", async () => {
    const { calls } = programmaticFetch(
      new Map([["/api/stories/", { status: 201 }]]),
    );
    const { wrapper } = await mountPage();
    await wrapper.find("#qa-series").setValue("S1");
    await wrapper.find("#qa-story").setValue("Story1");
    await wrapper.find("form").trigger("submit");
    await flushPromises();
    expect(calls.filter((c) => c.url.includes("/api/lore/"))).toHaveLength(0);
    expect(calls.some((c) => c.url.includes("/api/stories/S1/Story1/init")))
      .toBe(true);
  });

  it("default world_info filename alone does not activate the group", async () => {
    const { calls } = programmaticFetch(
      new Map([["/api/stories/", { status: 201 }]]),
    );
    const { wrapper } = await mountPage();
    await wrapper.find("#qa-series").setValue("S1");
    await wrapper.find("#qa-story").setValue("Story1");
    // worldInfoFilename retains default "world_info.md" — should NOT activate.
    await wrapper.find("form").trigger("submit");
    await flushPromises();
    expect(calls.filter((c) => c.url.includes("/api/lore/"))).toHaveLength(0);
  });

  it("character group active issues exactly init + character PUT (no _lore segment, scope-relative URL)", async () => {
    const { calls } = programmaticFetch(
      new Map([
        ["/api/lore/story/S1/Story1/", { status: 404 }], // preflight 404
        ["/api/stories/", { status: 201 }],
      ] as [string, MockFetchResponse][]),
    );
    // PUT requests share prefix /api/lore/story/S1/Story1/<filename>; we need to handle PUT vs GET differently.
    // Simpler: re-stub with a function-based responder.
    vi.unstubAllGlobals();
    const calls2: FetchCall[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        calls2.push({ url, init });
        const method = init?.method ?? "GET";
        if (url.includes("/api/stories/") && method === "POST") {
          return { ok: true, status: 201, json: async () => ({}), text: async () => "{}", headers: new Headers() };
        }
        if (url.includes("/api/lore/") && method === "GET") {
          return { ok: false, status: 404, json: async () => ({}), text: async () => "{}", headers: new Headers() };
        }
        if (url.includes("/api/lore/") && method === "PUT") {
          return { ok: true, status: 200, json: async () => ({}), text: async () => "{}", headers: new Headers() };
        }
        throw new Error(`Unmatched: ${method} ${url}`);
      }),
    );
    void calls;
    const { wrapper } = await mountPage();
    await wrapper.find("#qa-series").setValue("S1");
    await wrapper.find("#qa-story").setValue("Story1");
    await wrapper.find("#qa-char-name").setValue("Hero");
    await wrapper.find("#qa-char-body").setValue("desc");
    await wrapper.find("form").trigger("submit");
    await flushPromises();
    const puts = calls2.filter((c) => c.init?.method === "PUT");
    expect(puts).toHaveLength(1);
    expect(puts[0]!.url).toBe("/api/lore/story/S1/Story1/Hero.md");
    expect(puts[0]!.url.includes("/_lore/")).toBe(false);
    const body = JSON.parse(puts[0]!.init!.body as string);
    expect(body.frontmatter).toEqual({ enabled: true, priority: 0 });
    expect(body.content).toBe("# Hero\n\ndesc");
  });

  it("partial character group blocks submission with no network calls", async () => {
    const calls: FetchCall[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        calls.push({ url, init });
        return { ok: true, status: 200, json: async () => ({}), text: async () => "{}", headers: new Headers() };
      }),
    );
    const { wrapper } = await mountPage();
    await wrapper.find("#qa-series").setValue("S1");
    await wrapper.find("#qa-story").setValue("Story1");
    await wrapper.find("#qa-char-name").setValue("Hero");
    // characterContent intentionally empty
    await wrapper.find("form").trigger("submit");
    await flushPromises();
    expect(calls).toHaveLength(0);
    expect(wrapper.text()).toContain("請填寫名稱與內容");
  });

  it("rejects path traversal in character filename", async () => {
    const calls: FetchCall[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        calls.push({ url, init });
        return { ok: true, status: 200, json: async () => ({}), text: async () => "{}", headers: new Headers() };
      }),
    );
    const { wrapper } = await mountPage();
    await wrapper.find("#qa-series").setValue("S1");
    await wrapper.find("#qa-story").setValue("Story1");
    await wrapper.find("#qa-char-name").setValue("Hero");
    await wrapper.find("#qa-char-fn").setValue("../foo.md");
    await wrapper.find("#qa-char-body").setValue("desc");
    await wrapper.find("form").trigger("submit");
    await flushPromises();
    expect(calls).toHaveLength(0);
    expect(wrapper.text()).toContain("檔案名稱無效");
  });

  it("derives CJK filename verbatim", async () => {
    const calls: FetchCall[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        calls.push({ url, init });
        const method = init?.method ?? "GET";
        if (method === "POST")
          return { ok: true, status: 201, json: async () => ({}), text: async () => "{}", headers: new Headers() };
        if (method === "GET")
          return { ok: false, status: 404, json: async () => ({}), text: async () => "{}", headers: new Headers() };
        return { ok: true, status: 200, json: async () => ({}), text: async () => "{}", headers: new Headers() };
      }),
    );
    const { wrapper } = await mountPage();
    await wrapper.find("#qa-series").setValue("S1");
    await wrapper.find("#qa-story").setValue("Story1");
    await wrapper.find("#qa-char-name").setValue("林小美");
    await wrapper.find("#qa-char-body").setValue("desc");
    await wrapper.find("form").trigger("submit");
    await flushPromises();
    const put = calls.find((c) => c.init?.method === "PUT")!;
    expect(decodeURIComponent(put.url)).toBe("/api/lore/story/S1/Story1/林小美.md");
  });

  it("collision preflight surfaces overwrite checkbox and blocks submit until acknowledged", async () => {
    let putCount = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        const method = init?.method ?? "GET";
        if (method === "GET" && url.includes("/api/lore/"))
          return { ok: true, status: 200, json: async () => ({ frontmatter: {}, content: "" }), text: async () => "{}", headers: new Headers() };
        if (method === "POST")
          return { ok: true, status: 201, json: async () => ({}), text: async () => "{}", headers: new Headers() };
        if (method === "PUT") {
          putCount++;
          return { ok: true, status: 200, json: async () => ({}), text: async () => "{}", headers: new Headers() };
        }
        return { ok: true, status: 200, json: async () => ({}), text: async () => "{}", headers: new Headers() };
      }),
    );
    const { wrapper } = await mountPage();
    await wrapper.find("#qa-series").setValue("S1");
    await wrapper.find("#qa-story").setValue("Story1");
    await wrapper.find("#qa-char-name").setValue("Hero");
    await wrapper.find("#qa-char-body").setValue("desc");
    await wrapper.find("form").trigger("submit");
    await flushPromises();
    expect(wrapper.text()).toContain("已存在同名篇章");
    expect(putCount).toBe(0);
    // Toggle overwrite then resubmit
    const cb = wrapper.find(".collision input[type='checkbox']");
    await cb.setValue(true);
    await wrapper.find("form").trigger("submit");
    await flushPromises();
    expect(putCount).toBe(1);
  });

  it("init 200 surfaces non-blocking notice and proceeds to lore PUT", async () => {
    let putCount = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        const method = init?.method ?? "GET";
        if (method === "POST")
          return { ok: true, status: 200, json: async () => ({}), text: async () => "{}", headers: new Headers() };
        if (method === "GET" && url.includes("/api/lore/"))
          return { ok: false, status: 404, json: async () => ({}), text: async () => "{}", headers: new Headers() };
        if (method === "PUT") {
          putCount++;
          return { ok: true, status: 200, json: async () => ({}), text: async () => "{}", headers: new Headers() };
        }
        return { ok: true, status: 200, json: async () => ({}), text: async () => "{}", headers: new Headers() };
      }),
    );
    const { wrapper, router } = await mountPage();
    await wrapper.find("#qa-series").setValue("S1");
    await wrapper.find("#qa-story").setValue("Story1");
    await wrapper.find("#qa-char-name").setValue("Hero");
    await wrapper.find("#qa-char-body").setValue("desc");
    await wrapper.find("form").trigger("submit");
    await flushPromises();
    expect(putCount).toBe(1);
    expect(wrapper.text()).toContain("已沿用現有故事資料夾");
    expect(router.currentRoute.value.name).toBe("story");
  });

  it("init failure halts the sequence", async () => {
    let putCount = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        const method = init?.method ?? "GET";
        if (method === "POST")
          return { ok: false, status: 500, json: async () => ({ detail: "boom" }), text: async () => "{}", headers: new Headers() };
        if (method === "GET" && url.includes("/api/lore/"))
          return { ok: false, status: 404, json: async () => ({}), text: async () => "{}", headers: new Headers() };
        if (method === "PUT") {
          putCount++;
          return { ok: true, status: 200, json: async () => ({}), text: async () => "{}", headers: new Headers() };
        }
        return { ok: true, status: 200, json: async () => ({}), text: async () => "{}", headers: new Headers() };
      }),
    );
    const { wrapper } = await mountPage();
    await wrapper.find("#qa-series").setValue("S1");
    await wrapper.find("#qa-story").setValue("Story1");
    await wrapper.find("#qa-char-name").setValue("Hero");
    await wrapper.find("#qa-char-body").setValue("desc");
    await wrapper.find("form").trigger("submit");
    await flushPromises();
    expect(putCount).toBe(0);
    expect(wrapper.text()).toContain("建立故事失敗");
  });

  it("issues init then character PUT then world_info PUT in order when both groups active", async () => {
    const order: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        const method = init?.method ?? "GET";
        if (method === "POST") {
          order.push("init");
          return { ok: true, status: 201, json: async () => ({}), text: async () => "{}", headers: new Headers() };
        }
        if (method === "GET" && url.includes("/api/lore/"))
          return { ok: false, status: 404, json: async () => ({}), text: async () => "{}", headers: new Headers() };
        if (method === "PUT") {
          if (url.includes("Hero")) order.push("character");
          else order.push("worldinfo");
          return { ok: true, status: 200, json: async () => ({}), text: async () => "{}", headers: new Headers() };
        }
        return { ok: true, status: 200, json: async () => ({}), text: async () => "{}", headers: new Headers() };
      }),
    );
    const { wrapper } = await mountPage();
    await wrapper.find("#qa-series").setValue("S1");
    await wrapper.find("#qa-story").setValue("Story1");
    await wrapper.find("#qa-char-name").setValue("Hero");
    await wrapper.find("#qa-char-body").setValue("d");
    await wrapper.find("#qa-wi-name").setValue("Realm");
    await wrapper.find("#qa-wi-body").setValue("w");
    await wrapper.find("form").trigger("submit");
    await flushPromises();
    expect(order).toEqual(["init", "character", "worldinfo"]);
  });

  it("preflight 401 surfaces inline error and aborts before init/PUT", async () => {
    const calls: FetchCall[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        calls.push({ url, init });
        const method = init?.method ?? "GET";
        if (method === "GET" && url.includes("/api/lore/")) {
          return { ok: false, status: 401, json: async () => ({}), text: async () => "{}", headers: new Headers() };
        }
        throw new Error(`Unexpected ${method} ${url}`);
      }),
    );
    const { wrapper } = await mountPage();
    await wrapper.find("#qa-series").setValue("S1");
    await wrapper.find("#qa-story").setValue("Story1");
    await wrapper.find("#qa-char-name").setValue("Hero");
    await wrapper.find("#qa-char-body").setValue("d");
    await wrapper.find("form").trigger("submit");
    await flushPromises();
    expect(calls.filter((c) => (c.init?.method ?? "GET") === "POST")).toHaveLength(0);
    expect(calls.filter((c) => c.init?.method === "PUT")).toHaveLength(0);
    expect(wrapper.text()).toContain("預檢篇章失敗");
  });

  it("preflight 500 surfaces inline error and aborts before init/PUT", async () => {
    const calls: FetchCall[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        calls.push({ url, init });
        const method = init?.method ?? "GET";
        if (method === "GET" && url.includes("/api/lore/")) {
          return { ok: false, status: 500, json: async () => ({}), text: async () => "{}", headers: new Headers() };
        }
        throw new Error(`Unexpected ${method} ${url}`);
      }),
    );
    const { wrapper } = await mountPage();
    await wrapper.find("#qa-series").setValue("S1");
    await wrapper.find("#qa-story").setValue("Story1");
    await wrapper.find("#qa-char-name").setValue("Hero");
    await wrapper.find("#qa-char-body").setValue("d");
    await wrapper.find("form").trigger("submit");
    await flushPromises();
    expect(calls.filter((c) => (c.init?.method ?? "GET") === "POST")).toHaveLength(0);
    expect(wrapper.text()).toContain("預檢篇章失敗");
  });

  it("preflight network throw surfaces inline error and aborts", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("Failed to fetch");
      }),
    );
    const { wrapper } = await mountPage();
    await wrapper.find("#qa-series").setValue("S1");
    await wrapper.find("#qa-story").setValue("Story1");
    await wrapper.find("#qa-char-name").setValue("Hero");
    await wrapper.find("#qa-char-body").setValue("d");
    await wrapper.find("form").trigger("submit");
    await flushPromises();
    expect(wrapper.text()).toContain("預檢篇章失敗");
  });

  it("changing the filename after acknowledging clears the ack and re-blocks if new filename also collides", async () => {
    let putCount = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        const method = init?.method ?? "GET";
        if (method === "GET" && url.includes("/api/lore/"))
          return { ok: true, status: 200, json: async () => ({}), text: async () => "{}", headers: new Headers() };
        if (method === "POST")
          return { ok: true, status: 201, json: async () => ({}), text: async () => "{}", headers: new Headers() };
        if (method === "PUT") {
          putCount++;
          return { ok: true, status: 200, json: async () => ({}), text: async () => "{}", headers: new Headers() };
        }
        return { ok: true, status: 200, json: async () => ({}), text: async () => "{}", headers: new Headers() };
      }),
    );
    const { wrapper } = await mountPage();
    await wrapper.find("#qa-series").setValue("S1");
    await wrapper.find("#qa-story").setValue("Story1");
    await wrapper.find("#qa-char-name").setValue("Hero");
    await wrapper.find("#qa-char-body").setValue("d");
    await wrapper.find("form").trigger("submit");
    await flushPromises();
    expect(wrapper.text()).toContain("已存在同名篇章：Hero.md");
    await wrapper.find(".collision input[type='checkbox']").setValue(true);
    // User changes the filename BEFORE submitting again — ack should reset.
    await wrapper.find("#qa-char-fn").setValue("OtherName.md");
    expect(wrapper.text()).not.toContain("已存在同名篇章：Hero.md");
    await wrapper.find("form").trigger("submit");
    await flushPromises();
    // New filename also collides (mock returns 200 for any GET).
    expect(wrapper.text()).toContain("已存在同名篇章：OtherName.md");
    expect(putCount).toBe(0);
  });

  it("rejects series name starting with underscore", async () => {
    const calls: FetchCall[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        calls.push({ url, init });
        return { ok: true, status: 200, json: async () => ({}), text: async () => "{}", headers: new Headers() };
      }),
    );
    const { wrapper } = await mountPage();
    await wrapper.find("#qa-series").setValue("_reserved");
    await wrapper.find("#qa-story").setValue("Story1");
    await wrapper.find("form").trigger("submit");
    await flushPromises();
    expect(calls).toHaveLength(0);
    expect(wrapper.text()).toContain("系列名稱無效");
  });

  it("rejects story name starting with underscore", async () => {
    const calls: FetchCall[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        calls.push({ url, init });
        return { ok: true, status: 200, json: async () => ({}), text: async () => "{}", headers: new Headers() };
      }),
    );
    const { wrapper } = await mountPage();
    await wrapper.find("#qa-series").setValue("S1");
    await wrapper.find("#qa-story").setValue("_hidden");
    await wrapper.find("form").trigger("submit");
    await flushPromises();
    expect(calls).toHaveLength(0);
    expect(wrapper.text()).toContain("故事名稱無效");
  });

  it("retry after world_info PUT failure does not re-preflight or re-PUT character", async () => {
    let charPutCount = 0;
    let charGetCount = 0;
    let wiPutCount = 0;
    let wiPutShouldFail = true;
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
          if (wiPutShouldFail) {
            return { ok: false, status: 500, json: async () => ({ detail: "boom" }), text: async () => "{}", headers: new Headers() };
          }
          return { ok: true, status: 200, json: async () => ({}), text: async () => "{}", headers: new Headers() };
        }
        return { ok: true, status: 200, json: async () => ({}), text: async () => "{}", headers: new Headers() };
      }),
    );
    const { wrapper } = await mountPage();
    await wrapper.find("#qa-series").setValue("S1");
    await wrapper.find("#qa-story").setValue("Story1");
    await wrapper.find("#qa-char-name").setValue("Hero");
    await wrapper.find("#qa-char-body").setValue("d");
    await wrapper.find("#qa-wi-name").setValue("Realm");
    await wrapper.find("#qa-wi-body").setValue("w");
    await wrapper.find("form").trigger("submit");
    await flushPromises();
    expect(charPutCount).toBe(1);
    expect(wiPutCount).toBe(1);
    expect(wrapper.text()).toContain("建立世界篇章失敗");
    // Retry succeeds for world_info.
    wiPutShouldFail = false;
    const charGetBefore = charGetCount;
    await wrapper.find("form").trigger("submit");
    await flushPromises();
    // Character preflight + PUT should NOT have re-run.
    expect(charGetCount).toBe(charGetBefore);
    expect(charPutCount).toBe(1);
    expect(wiPutCount).toBe(2);
  });
});
