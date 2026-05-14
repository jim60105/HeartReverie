// Copyright (C) 2026 Jim Chen <Jim@ChenJ.im>, licensed under AGPL-3.0-or-later
import { describe, expect, it, vi } from "vitest";
import { FrontendHookDispatcher } from "@/lib/plugin-hooks";

vi.mock("@/composables/useNotification", () => ({
  useNotification: () => ({ notify: () => {} }),
}));

describe("FrontendHookDispatcher — introspect", () => {
  it("returns empty record when nothing registered", () => {
    const d = new FrontendHookDispatcher();
    expect(Object.keys(d.introspect()).length).toBe(0);
  });

  it("captures plugin, priority, errorCount=0 per entry", () => {
    const d = new FrontendHookDispatcher();
    d.register("notification", () => {}, 100, "plugin-a");
    d.register("notification", () => {}, 50, "plugin-b");
    const dump = d.introspect();
    const list = dump["notification"]!;
    expect(list).toHaveLength(2);
    // sorted ascending by priority
    expect(list[0]!.plugin).toBe("plugin-b");
    expect(list[0]!.priority).toBe(50);
    expect(list[0]!.errorCount).toBe(0);
  });
});

describe("FrontendHookDispatcher — async-reject", () => {
  it("throws when registering an async handler on non-action-button stage", () => {
    const d = new FrontendHookDispatcher();
    expect(() => {
      d.register("notification", async () => {}, 100, "plugin-a");
    }).toThrow(/must be synchronous/);
  });

  it("allows async handler on action-button:click", () => {
    const d = new FrontendHookDispatcher();
    expect(() => {
      d.register("action-button:click", async () => {}, 100, "plugin-a");
    }).not.toThrow();
  });
});

describe("FrontendHookDispatcher — duplicate (plugin, stage) rejection", () => {
  it("throws on second registration with same (plugin, stage) for action-button:click only", () => {
    const d = new FrontendHookDispatcher();
    d.register("action-button:click", async () => {}, 100, "plugin-a");
    expect(() => {
      d.register("action-button:click", async () => {}, 50, "plugin-a");
    }).toThrow(/duplicate/);
  });

  it("permits multiple handlers per (plugin, stage) on non-action-button stages", () => {
    const d = new FrontendHookDispatcher();
    d.register("notification", () => {}, 100, "plugin-a");
    expect(() => {
      d.register("notification", () => {}, 50, "plugin-a");
    }).not.toThrow();
  });

  it("permits same stage from different plugins", () => {
    const d = new FrontendHookDispatcher();
    d.register("notification", () => {}, 100, "plugin-a");
    expect(() => {
      d.register("notification", () => {}, 100, "plugin-b");
    }).not.toThrow();
  });
});

describe("FrontendHookDispatcher — finalizeBoot", () => {
  it("records declaredOnly mismatch when manifest declares but plugin never registers", () => {
    const d = new FrontendHookDispatcher();
    // plugin-a registers nothing
    d.finalizeBoot([
      { plugin: "plugin-a", hooks: [{ stage: "notification" }] },
    ]);
    const mismatches = d.getBootMismatches();
    expect(mismatches).toHaveLength(1);
    expect(mismatches[0]!.declaredOnly).toContain("notification");
    expect(mismatches[0]!.registeredOnly).toEqual([]);
  });

  it("records registeredOnly mismatch when plugin registers but manifest is silent", () => {
    const d = new FrontendHookDispatcher();
    d.register("notification", () => {}, 100, "plugin-a");
    d.finalizeBoot([{ plugin: "plugin-a", hooks: [] }]);
    const mismatches = d.getBootMismatches();
    expect(mismatches).toHaveLength(1);
    expect(mismatches[0]!.registeredOnly).toContain("notification");
    expect(mismatches[0]!.declaredOnly).toEqual([]);
  });

  it("no mismatch when declarations match registrations exactly", () => {
    const d = new FrontendHookDispatcher();
    d.register("notification", () => {}, 100, "plugin-a");
    d.finalizeBoot([
      { plugin: "plugin-a", hooks: [{ stage: "notification" }] },
    ]);
    expect(d.getBootMismatches()).toHaveLength(0);
  });

  it("ignores declared BACKEND stages (only frontend stages are checked)", () => {
    const d = new FrontendHookDispatcher();
    d.register("notification", () => {}, 100, "plugin-a");
    d.finalizeBoot([
      {
        plugin: "plugin-a",
        hooks: [
          { stage: "prompt-assembly" }, // backend — must be ignored
          { stage: "notification" },
        ],
      },
    ]);
    expect(d.getBootMismatches()).toHaveLength(0);
  });

  it("does not throw when notification system is unavailable", () => {
    const d = new FrontendHookDispatcher();
    expect(() => {
      d.finalizeBoot([
        { plugin: "plugin-a", hooks: [{ stage: "notification" }] },
      ]);
    }).not.toThrow();
  });
});
