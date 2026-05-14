// Copyright (C) 2026 Jim Chen <Jim@ChenJ.im>, licensed under AGPL-3.0-or-later

import { mount, flushPromises } from "@vue/test-utils";
import PluginSettingsPage from "@/components/PluginSettingsPage.vue";

const notifyMock = vi.fn();

vi.mock("@/composables/useAuth", () => ({
  useAuth: () => ({
    getAuthHeaders: () => ({ "X-Passphrase": "pp" }),
  }),
}));

vi.mock("@/composables/useNotification", () => ({
  useNotification: () => ({ notify: notifyMock }),
}));

vi.mock("vue-router", () => ({
  useRoute: () => ({ params: { pluginName: "demo" } }),
  useRouter: () => ({ back: vi.fn(), push: vi.fn() }),
}));

interface FetchPlan {
  schema?: Record<string, unknown>;
  settings?: Record<string, unknown>;
  schemaMeta?: Record<string, unknown>;
  validate?: { errors?: unknown[]; warnings?: unknown[] };
  put?: {
    status: number;
    body: { errors?: unknown[]; warnings?: unknown[]; detail?: string };
  };
}

function installFetch(plan: FetchPlan): {
  putCalls: Array<{ url: string; body: unknown }>;
  putFn: ReturnType<typeof vi.fn>;
} {
  const putCalls: Array<{ url: string; body: unknown }> = [];
  const putFn = vi.fn();
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const method = (init?.method || "GET").toUpperCase();
    if (method === "GET" && url.endsWith("/settings-schema")) {
      return makeResponse(200, plan.schema ?? {});
    }
    if (method === "GET" && url.endsWith("/schema-meta")) {
      return makeResponse(200, plan.schemaMeta ?? {
        schemaVersion: 1,
        pathRoots: ["playground/lore/"],
        formats: ["path"],
      });
    }
    if (method === "GET" && url.endsWith("/settings")) {
      return makeResponse(200, plan.settings ?? {});
    }
    if (method === "POST" && url.endsWith("/settings/validate")) {
      return makeResponse(200, plan.validate ?? { errors: [], warnings: [] });
    }
    if (method === "PUT" && url.endsWith("/settings")) {
      const body = init?.body ? JSON.parse(String(init.body)) : null;
      putCalls.push({ url, body });
      putFn(body);
      const p = plan.put ?? { status: 200, body: { errors: [], warnings: [] } };
      return makeResponse(p.status, p.body);
    }
    return makeResponse(404, { error: "not found" });
  });
  vi.stubGlobal("fetch", fetchMock);
  return { putCalls, putFn };
}

function makeResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response;
}

describe("PluginSettingsPage", () => {
  beforeEach(() => {
    notifyMock.mockReset();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("renders schema-driven fields and saves successfully", async () => {
    installFetch({
      schema: {
        type: "object",
        properties: { greeting: { type: "string", title: "Greeting" } },
      },
      settings: { greeting: "hi" },
    });

    const wrapper = mount(PluginSettingsPage);
    await flushPromises();
    expect(wrapper.text()).toContain("Greeting");
    const input = wrapper.find("input[type='text']");
    expect((input.element as HTMLInputElement).value).toBe("hi");

    await input.setValue("hello");
    await wrapper.find("form").trigger("submit");
    await flushPromises();
    expect(notifyMock).toHaveBeenCalled();
  });

  it("renders top-level errors banner when PUT returns 400", async () => {
    installFetch({
      schema: {
        type: "object",
        properties: { greeting: { type: "string", minLength: 5 } },
      },
      settings: { greeting: "ok" },
      put: {
        status: 400,
        body: {
          errors: [
            {
              path: "greeting",
              keyword: "minLength",
              messageKey: "minLength",
              params: { minLength: 5 },
            },
          ],
          warnings: [],
        },
      },
    });

    const wrapper = mount(PluginSettingsPage);
    await flushPromises();
    await wrapper.find("input[type='text']").setValue("nope");
    await wrapper.find("form").trigger("submit");
    await flushPromises();
    expect(wrapper.find(".errors-banner").exists()).toBe(true);
    expect(wrapper.text()).toContain("不可少於 5");
  });

  it("renders warnings banner for warnings-only PUT", async () => {
    installFetch({
      schema: {
        type: "object",
        properties: { greeting: { type: "string" } },
      },
      settings: { greeting: "hi" },
      put: {
        status: 200,
        body: {
          errors: [],
          warnings: [
            {
              path: "other",
              keyword: "minimum",
              messageKey: "minimum",
              params: { minimum: 50 },
            },
          ],
        },
      },
    });
    const wrapper = mount(PluginSettingsPage);
    await flushPromises();
    await wrapper.find("input[type='text']").setValue("changed");
    await wrapper.find("form").trigger("submit");
    await flushPromises();
    expect(wrapper.find(".warnings-banner").exists()).toBe(true);
    expect(wrapper.text()).toContain("不可小於 50");
    expect(notifyMock).toHaveBeenCalled();
  });

  it("renders the x-legacy-warnings banner from GET", async () => {
    installFetch({
      schema: {
        type: "object",
        properties: { greeting: { type: "string" } },
      },
      settings: {
        greeting: "hi",
        "x-legacy-warnings": [
          {
            path: "greeting",
            keyword: "pattern",
            messageKey: "pattern",
            params: { pattern: "^[A-Z]" },
          },
        ],
      },
    });
    const wrapper = mount(PluginSettingsPage);
    await flushPromises();
    expect(wrapper.find(".legacy-warnings-banner").exists()).toBe(true);
    expect(wrapper.text()).toContain("不符合目前的 schema");
  });

  it("includes _changedPaths in the PUT body", async () => {
    const { putCalls } = installFetch({
      schema: {
        type: "object",
        properties: { greeting: { type: "string" } },
      },
      settings: { greeting: "hi" },
    });
    const wrapper = mount(PluginSettingsPage);
    await flushPromises();
    await wrapper.find("input[type='text']").setValue("changed");
    await wrapper.find("form").trigger("submit");
    await flushPromises();
    expect(putCalls.length).toBe(1);
    const body = putCalls[0]!.body as { _changedPaths?: string[] };
    expect(body._changedPaths).toContain("greeting");
  });
});
