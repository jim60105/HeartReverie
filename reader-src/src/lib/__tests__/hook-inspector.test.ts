// Copyright (C) 2026 Jim Chen <Jim@ChenJ.im>, licensed under AGPL-3.0-or-later
import { describe, expect, it } from "vitest";
import { detectConflicts, mergeFrontendDeclarations } from "@/lib/hook-inspector";
import type {
  HandlerInfo,
  ManifestDeclarations,
  PipelineFieldRef,
} from "@/types";

const pipeline: readonly PipelineFieldRef[] = Object.freeze([
  { stage: "response-stream", field: "chunk" },
]);

function h(
  plugin: string,
  priority: number,
  opts: Partial<HandlerInfo> = {},
): HandlerInfo {
  return { plugin, priority, errorCount: 0, ...opts };
}

describe("mergeFrontendDeclarations", () => {
  it("enriches handlers with manifest reads/writes/note", () => {
    const introspect = {
      "prompt-assembly": [h("a", 100)],
    };
    const manifest: ManifestDeclarations[] = [
      {
        plugin: "a",
        hooks: [{
          stage: "prompt-assembly",
          reads: ["x"],
          writes: ["y"],
          note: "demo",
        }],
      },
    ];
    const merged = mergeFrontendDeclarations(introspect, manifest);
    expect(merged["prompt-assembly"]![0]).toMatchObject({
      plugin: "a",
      reads: ["x"],
      writes: ["y"],
      note: "demo",
    });
  });
  it("handlers without a matching declaration pass through unchanged", () => {
    const introspect = { foo: [h("b", 50)] };
    const merged = mergeFrontendDeclarations(introspect, []);
    expect(merged.foo![0]).toEqual({ plugin: "b", priority: 50, errorCount: 0 });
  });
});

describe("detectConflicts", () => {
  it("C1 fires when two plugins write the same non-pipeline field", () => {
    const backend = {
      "prompt-assembly": [
        h("a", 50, { writes: ["title"] }),
        h("b", 100, { writes: ["title"] }),
      ],
    };
    const conflicts = detectConflicts(backend, {}, pipeline);
    expect(conflicts.some((c) => c.kind === "C1-multi-write" && c.field === "title")).toBe(true);
  });
  it("C1 is suppressed for pipeline-allowlisted (stage,field)", () => {
    const backend = {
      "response-stream": [
        h("a", 50, { writes: ["chunk"] }),
        h("b", 100, { writes: ["chunk"] }),
      ],
    };
    const conflicts = detectConflicts(backend, {}, pipeline);
    expect(conflicts.some((c) => c.kind === "C1-multi-write")).toBe(false);
  });
  it("C2 stale-read fires across plugins", () => {
    const backend = {
      "prompt-assembly": [
        h("reader", 50, { reads: ["scenario"] }),
        h("writer", 100, { writes: ["scenario"] }),
      ],
    };
    const conflicts = detectConflicts(backend, {}, pipeline);
    expect(conflicts.some((c) => c.kind === "C2-stale-read")).toBe(true);
  });
  it("C2 does NOT fire when reader and writer are the same plugin", () => {
    const backend = {
      "prompt-assembly": [
        h("solo", 50, { reads: ["x"] }),
        h("solo", 100, { writes: ["x"] }),
      ],
    };
    // same plugin can't register twice in real code, but the detector must not flag it as cross-plugin stale-read
    const conflicts = detectConflicts(backend, {}, pipeline);
    expect(conflicts.some((c) => c.kind === "C2-stale-read")).toBe(false);
  });
  it("C2 fires even on pipeline fields (allowlist does NOT exempt stale-reads)", () => {
    const backend = {
      "response-stream": [
        h("reader", 50, { reads: ["chunk"] }),
        h("writer", 100, { writes: ["chunk"] }),
      ],
    };
    const conflicts = detectConflicts(backend, {}, pipeline);
    expect(conflicts.some((c) => c.kind === "C2-stale-read")).toBe(true);
  });
  it("C3 same-priority across plugins", () => {
    const backend = {
      "post-response": [h("a", 100), h("b", 100)],
    };
    const conflicts = detectConflicts(backend, {}, pipeline);
    expect(conflicts.some((c) => c.kind === "C3-same-priority")).toBe(true);
  });
  it("C4 runtime-error reports when errorCount > 0", () => {
    const backend = {
      "post-response": [h("a", 100, { errorCount: 3 })],
    };
    const conflicts = detectConflicts(backend, {}, pipeline);
    expect(conflicts.some((c) => c.kind === "C4-runtime-error")).toBe(true);
  });
  it("handles handlers with null/undefined reads/writes without throwing", () => {
    const backend = {
      "post-response": [h("a", 100), h("b", 100, { reads: undefined, writes: undefined })],
    };
    expect(() => detectConflicts(backend, {}, pipeline)).not.toThrow();
  });
});
