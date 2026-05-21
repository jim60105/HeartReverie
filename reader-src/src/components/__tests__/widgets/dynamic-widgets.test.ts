// Copyright (C) 2026 Jim Chen <Jim@ChenJ.im>, licensed under AGPL-3.0-or-later

import { flushPromises } from "@vue/test-utils";
import { mountWidget } from "./_mount-widget";
import SelectWidget from "@/components/widgets/SelectWidget.vue";
import MultiSelectWidget from "@/components/widgets/MultiSelectWidget.vue";
import ComboboxWidget from "@/components/widgets/ComboboxWidget.vue";

vi.mock("@/composables/useAuth", () => ({
  useAuth: () => ({
    getAuthHeaders: () => ({ "X-Passphrase": "pp" }),
  }),
}));

describe("SelectWidget", () => {
  it("renders enum options and emits on change", async () => {
    const { wrapper, emitted } = mountWidget(SelectWidget, {
      schema: { type: "string", enum: ["a", "b", "c"] },
      modelValue: "a",
    });
    const opts = wrapper.findAll("option");
    expect(opts.length).toBeGreaterThanOrEqual(4); // placeholder + 3
    await wrapper.find("select").setValue("b");
    expect(emitted()?.[0]).toEqual(["b"]);
  });

  it("fetches dynamic options from x-options-url", async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) =>
      ({
        ok: true,
        status: 200,
        json: async () => ({
          options: [
            { value: "x", label: "Apple" },
            { value: "y", label: "Banana" },
          ],
        }),
      }) as unknown as Response,
    );
    vi.stubGlobal("fetch", fetchMock);
    try {
      const { wrapper } = mountWidget(SelectWidget, {
        schema: { type: "string", enum: [], "x-options-url": "/api/things" },
        modelValue: "",
      });
      await flushPromises();
      expect(fetchMock).toHaveBeenCalled();
      const [calledUrl, init] = fetchMock.mock.calls[0]!;
      expect(calledUrl).toBe("/api/things");
      expect(new Headers(init?.headers).get("X-Passphrase")).toBe("pp");
      const opts = wrapper.findAll("option").map((o) => o.text());
      expect(opts.join(",")).toContain("Apple");
      expect(opts.join(",")).toContain("Banana");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("falls back to enum on failed fetch and displays error", async () => {
    const fetchMock = vi.fn(async () => {
      throw new Error("offline");
    });
    vi.stubGlobal("fetch", fetchMock);
    try {
      const { wrapper } = mountWidget(SelectWidget, {
        schema: { type: "string", enum: ["a", "b"], "x-options-url": "/api/x" },
        modelValue: "",
      });
      await flushPromises();
      expect(wrapper.find(".widget-fetch-error").exists()).toBe(true);
      const labels = wrapper.findAll("option").map((o) => o.text());
      expect(labels.join(",")).toContain("a");
      expect(labels.join(",")).toContain("b");
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe("MultiSelectWidget", () => {
  it("toggles selection from item.enum", async () => {
    const { wrapper, emitted } = mountWidget(MultiSelectWidget, {
      schema: { type: "array", items: { type: "string", enum: ["a", "b", "c"] } },
      modelValue: ["a"],
    });
    const boxes = wrapper.findAll("input[type='checkbox']");
    expect(boxes.length).toBe(3);
    // toggle "b"
    await boxes[1]!.setValue(true);
    const last = emitted()?.at(-1) as [string[]] | undefined;
    expect(last?.[0]).toEqual(["a", "b"]);
  });

  it("loads options from items.x-options-url", async () => {
    const fetchMock = vi.fn(async () =>
      ({
        ok: true,
        json: async () => ({
          options: [
            { value: "x", label: "X" },
            { value: "y", label: "Y" },
          ],
        }),
      }) as unknown as Response,
    );
    vi.stubGlobal("fetch", fetchMock);
    try {
      const { wrapper } = mountWidget(MultiSelectWidget, {
        schema: {
          type: "array",
          items: { type: "string", "x-options-url": "/api/o" },
        },
        modelValue: [],
      });
      await flushPromises();
      expect(fetchMock).toHaveBeenCalled();
      expect(wrapper.findAll("input[type='checkbox']").length).toBe(2);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe("ComboboxWidget", () => {
  it("renders datalist and emits typed value", async () => {
    const { wrapper, emitted } = mountWidget(ComboboxWidget, {
      schema: { type: "string", "x-options-url": "/api/opt" },
      modelValue: "",
    });
    await wrapper.find("input").setValue("typed");
    expect(emitted()?.[0]).toEqual(["typed"]);
    expect(wrapper.find("datalist").exists()).toBe(true);
  });
});
