// Copyright (C) 2026 Jim Chen <Jim@ChenJ.im>, licensed under AGPL-3.0-or-later
import { flushPromises, mount } from "@vue/test-utils";
import { defineComponent, h, nextTick } from "vue";

// Stub heavy CodeMirror module — its imports break in happy-dom.
vi.mock("@/components/VentoCodeEditor.vue", () => ({
  default: defineComponent({
    props: ["source", "templatePath", "variables", "readOnly", "series", "story", "enableSaveShortcut"],
    emits: ["update:source", "lint", "save-request"],
    setup(_props, { expose }) {
      expose({ jumpTo: vi.fn(), focus: vi.fn(), insertAtCursor: vi.fn() });
      return () => h("div", { class: "mock-template-editor" });
    },
  }),
}));

vi.mock("@/composables/useAuth", () => ({
  useAuth: () => ({ getAuthHeaders: () => ({ "X-Passphrase": "pw" }) }),
}));

const notifyMock = vi.fn();
vi.mock("@/composables/useNotification", () => ({
  useNotification: () => ({ notify: notifyMock }),
}));

import TemplateEditorPage from "@/components/TemplateEditorPage.vue";

function jsonResponse(body: unknown, status = 200) {
  return Promise.resolve({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  });
}

function setupFetch(routes: Record<string, (body?: unknown) => Promise<unknown>>) {
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const u = typeof url === "string" ? url.split("?")[0]! : "";
    const key = `${init?.method ?? "GET"} ${u}`;
    const handler = routes[key];
    if (!handler) {
      return jsonResponse({ detail: "not stubbed: " + key }, 404);
    }
    const body = init?.body ? JSON.parse(init.body as string) : undefined;
    return handler(body);
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("TemplateEditorPage", () => {
  beforeEach(() => {
    notifyMock.mockClear();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("blocks save when lint reports errors", async () => {
    const writeCalls: unknown[] = [];
    setupFetch({
      "GET /api/templates": () => jsonResponse({
        entries: [{ id: "system.md", label: "system.md", path: "system.md", templatePath: "system.md", kind: "system", editable: true, sizeBytes: 0 }],
        templates: [],
      }),
      "GET /api/templates/variables": () => jsonResponse({ variables: [] }),
      "GET /api/templates/source": () => jsonResponse({ source: "hello" }),
      "POST /api/templates/lint": () => jsonResponse({
        diagnostics: [{ ruleId: "vento.parse-error", severity: "error", line: 1, column: 1, message: "boom" }],
      }),
      "POST /api/templates/preview": () => jsonResponse({ kind: "messages", messages: [] }),
      "PUT /api/templates": (b) => {
        writeCalls.push(b);
        return jsonResponse({ ok: true, path: "/x/system.md" });
      },
    });
    const w = mount(TemplateEditorPage);
    await flushPromises();
    await nextTick();
    // Find save button.
    const saveBtn = w.findAll("button").find((b) => b.text().trim() === "儲存");
    expect(saveBtn).toBeDefined();
    // Make dirty by simulating editor update.
    (w.vm as unknown as { editorSource: string; baselineSource: string; dirty: boolean }).editorSource = "changed";
    (w.vm as unknown as { dirty: boolean }).dirty = true;
    await nextTick();
    await saveBtn!.trigger("click");
    await flushPromises();
    expect(writeCalls.length).toBe(0);
    const errToast = notifyMock.mock.calls.find((c) => String(c[0].title).includes("請先修復"));
    expect(errToast).toBeTruthy();
  });

  it("allows save with only warnings (shows diff modal)", async () => {
    setupFetch({
      "GET /api/templates": () => jsonResponse({
        entries: [{ id: "system.md", label: "system.md", path: "system.md", templatePath: "system.md", kind: "system", editable: true, sizeBytes: 0 }],
        templates: [],
      }),
      "GET /api/templates/variables": () => jsonResponse({ variables: [] }),
      "GET /api/templates/source": () => jsonResponse({ source: "hello" }),
      "POST /api/templates/lint": () => jsonResponse({
        diagnostics: [{ ruleId: "vento.unknown-variable", severity: "warning", line: 1, column: 1, message: "unknown" }],
      }),
      "POST /api/templates/preview": () => jsonResponse({ kind: "messages", messages: [] }),
      "PUT /api/templates": () => jsonResponse({ ok: true, path: "/x/system.md" }),
    });
    const w = mount(TemplateEditorPage);
    await flushPromises();
    (w.vm as unknown as { editorSource: string; dirty: boolean }).editorSource = "changed";
    (w.vm as unknown as { dirty: boolean }).dirty = true;
    await nextTick();
    const saveBtn = w.findAll("button").find((b) => b.text().trim() === "儲存");
    await saveBtn!.trigger("click");
    await flushPromises();
    const warningToast = notifyMock.mock.calls.find((c) => String(c[0].title).includes("警告"));
    expect(warningToast).toBeTruthy();
    // Diff modal appears.
    expect(w.text()).toContain("確認儲存");
  });

  it("surfaces 403 toast on plugin write attempt", async () => {
    setupFetch({
      "GET /api/templates": () => jsonResponse({
        entries: [{ id: "system.md", label: "system.md", path: "system.md", templatePath: "system.md", kind: "system", editable: true, sizeBytes: 0 }],
        templates: [],
      }),
      "GET /api/templates/variables": () => jsonResponse({ variables: [] }),
      "GET /api/templates/source": () => jsonResponse({ source: "" }),
      "POST /api/templates/lint": () => jsonResponse({ diagnostics: [] }),
      "POST /api/templates/preview": () => jsonResponse({ kind: "messages", messages: [] }),
      "PUT /api/templates": () => jsonResponse({ detail: "plugin fragments are read-only" }, 403),
    });
    const w = mount(TemplateEditorPage);
    await flushPromises();
    (w.vm as unknown as { editorSource: string; dirty: boolean }).editorSource = "x";
    (w.vm as unknown as { dirty: boolean }).dirty = true;
    await nextTick();
    const saveBtn = w.findAll("button").find((b) => b.text().trim() === "儲存");
    await saveBtn!.trigger("click");
    await flushPromises();
    // Diff modal open — click confirm.
    const confirmBtn = w.findAll("button").find((b) => b.text().trim() === "確認儲存");
    expect(confirmBtn).toBeDefined();
    await confirmBtn!.trigger("click");
    await flushPromises();
    const toast = notifyMock.mock.calls.find((c) => String(c[0].title).includes("唯讀"));
    expect(toast).toBeTruthy();
  });
});
