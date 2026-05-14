// Copyright (C) 2026 Jim Chen <Jim@ChenJ.im>, licensed under AGPL-3.0-or-later
import { ventoCompletionSource } from "@/lib/cm-vento-complete";
import { VENTO_HELPERS } from "@/lib/template";
import { EditorState } from "@codemirror/state";
import { CompletionContext } from "@codemirror/autocomplete";
import type { VariableEntry } from "@/lib/template-api";

function makeCtx(doc: string, pos = doc.length, explicit = true): CompletionContext {
  const state = EditorState.create({ doc });
  return new CompletionContext(state, pos, explicit);
}

describe("ventoCompletionSource", () => {
  it("returns full VENTO_HELPERS list after `|>`", () => {
    const src = ventoCompletionSource(() => []);
    const ctx = makeCtx("{{ foo |> ");
    const res = src(ctx) as { options: { label: string }[] } | null;
    expect(res).not.toBeNull();
    const labels = (res!.options.map((o) => o.label)).sort();
    expect(labels).toEqual([...VENTO_HELPERS].sort());
  });

  it("returns variable catalog after `{{ `", () => {
    const catalog: VariableEntry[] = [
      { name: "user_input", source: "core" },
      { name: "series_name", source: "core" },
      { name: "lore_alice", source: "lore" },
    ];
    const src = ventoCompletionSource(() => catalog);
    const ctx = makeCtx("{{ ");
    const res = src(ctx) as { options: { label: string }[] } | null;
    expect(res).not.toBeNull();
    const labels = res!.options.map((o) => o.label).sort();
    expect(labels).toEqual(["lore_alice", "series_name", "user_input"]);
  });

  it("includes source-attribution badges in detail", () => {
    const catalog: VariableEntry[] = [
      { name: "x", source: "plugin-fragment", pluginName: "thinking" },
    ];
    const src = ventoCompletionSource(() => catalog);
    const res = src(makeCtx("{{ ")) as { options: { detail?: string }[] } | null;
    expect(res!.options[0]!.detail).toContain("plugin-fragment");
    expect(res!.options[0]!.detail).toContain("thinking");
  });

  it("returns null outside of tag", () => {
    const src = ventoCompletionSource(() => []);
    expect(src(makeCtx("hello world"))).toBeNull();
  });
});
