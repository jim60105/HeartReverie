// Copyright (C) 2026 Jim Chen <Jim@ChenJ.im>, licensed under AGPL-3.0-or-later
//
// Shared stub for VentoCodeEditor used in component tests. The real editor
// boots a CodeMirror view that does not initialize cleanly in happy-dom, so
// tests replace it with a lightweight `<textarea>`-backed mock that emits
// `update:source` on input and exposes a callable `insertAtCursor`.

import { defineComponent, h, ref } from "vue";

export const VentoCodeEditorStub = defineComponent({
  name: "VentoCodeEditorStub",
  props: {
    source: { type: String, required: true },
    variables: { type: Array, default: () => [] },
    templatePath: String,
    kind: String,
    role: String,
    scope: String,
    pluginName: String,
    series: String,
    story: String,
    readOnly: Boolean,
    enableSaveShortcut: Boolean,
    enableLineNumbers: { type: Boolean, default: true },
    disableLint: Boolean,
    lazyLint: Boolean,
    minLines: { type: Number, default: 3 },
    maxLines: { type: Number, default: 30 },
  },
  emits: ["update:source", "lint", "save-request"],
  setup(props, { emit, expose }) {
    const taRef = ref<HTMLTextAreaElement | null>(null);
    expose({
      focus(): void {
        taRef.value?.focus();
      },
      insertAtCursor(text: string): void {
        const ta = taRef.value;
        if (!ta) return;
        const start = ta.selectionStart ?? props.source.length;
        const end = ta.selectionEnd ?? props.source.length;
        const next = props.source.slice(0, start) + text + props.source.slice(end);
        emit("update:source", next);
      },
      jumpTo(_l: number, _c: number): void {},
    });
    return () =>
      h("textarea", {
        ref: taRef,
        class: "mock-vento-editor",
        value: props.source,
        onInput: (e: Event) => {
          emit("update:source", (e.target as HTMLTextAreaElement).value);
        },
      });
  },
});
