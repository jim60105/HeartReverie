// Copyright (C) 2026 Jim Chen <Jim@ChenJ.im>, licensed under AGPL-3.0-or-later
import { mount } from "@vue/test-utils";
import TemplateEditor from "@/components/TemplateEditor.vue";

vi.mock("@/composables/useAuth", () => ({
  useAuth: () => ({ getAuthHeaders: () => ({ "X-Passphrase": "pw" }) }),
}));

describe("TemplateEditor", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ diagnostics: [] }),
      }),
    );
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("mounts and renders host div", () => {
    const w = mount(TemplateEditor, {
      props: {
        source: "{{ hello }}",
        templatePath: "system.md",
        variables: [],
        readOnly: false,
      },
    });
    expect(w.find(".cm-vento-host").exists()).toBe(true);
  });

  it("applies is-readonly class when readOnly", () => {
    const w = mount(TemplateEditor, {
      props: {
        source: "x",
        templatePath: "plugin:p:f.md",
        variables: [],
        readOnly: true,
      },
    });
    expect(w.find(".cm-vento-host.is-readonly").exists()).toBe(true);
  });
});
