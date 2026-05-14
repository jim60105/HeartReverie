<script setup lang="ts">
import { computed } from "vue";
import type { WidgetProps } from "./types";
import WidgetErrors from "./WidgetErrors.vue";

const props = defineProps<WidgetProps>();
const emit = defineEmits<(e: "update:modelValue", value: string) => void>();

// Effective roots = intersection of context.schemaMeta.pathRoots and field's x-path-roots.
const effectiveRoots = computed<string[]>(() => {
  const meta = props.context.schemaMeta?.pathRoots ?? [];
  const declared = props.schema["x-path-roots"];
  if (!Array.isArray(declared)) return [...meta];
  const declaredSet = new Set(declared.filter((r): r is string => typeof r === "string"));
  return meta.filter((r) => declaredSet.has(r));
});

const value = computed<string>(() => {
  const v = props.modelValue;
  return typeof v === "string" ? v : "";
});

const selectedRoot = computed<string>(() => {
  for (const root of effectiveRoots.value) {
    if (value.value.startsWith(root)) return root;
  }
  return effectiveRoots.value[0] ?? "";
});

const rest = computed<string>(() => {
  const root = selectedRoot.value;
  if (root && value.value.startsWith(root)) return value.value.slice(root.length);
  return value.value;
});

function emitPath(root: string, suffix: string): void {
  emit("update:modelValue", `${root}${suffix}`);
}

function onRootChange(ev: Event): void {
  const root = (ev.target as HTMLSelectElement).value;
  emitPath(root, rest.value);
}

function onRestInput(ev: Event): void {
  emitPath(selectedRoot.value, (ev.target as HTMLInputElement).value);
}

const inputId = computed(() => `f-${props.path || "root"}`);
const noRoots = computed(() => effectiveRoots.value.length === 0);
</script>

<template>
  <div class="widget path-picker-widget">
    <p v-if="noRoots" class="path-warning">⚠ 此欄位無可用路徑根目錄</p>
    <div v-else class="path-row">
      <select class="field-input path-root" :value="selectedRoot" @change="onRootChange">
        <option v-for="root in effectiveRoots" :key="root" :value="root">{{ root }}</option>
      </select>
      <input
        :id="inputId"
        type="text"
        class="field-input path-rest"
        :value="rest"
        placeholder="檔案或目錄路徑…"
        @input="onRestInput"
      />
    </div>
    <WidgetErrors :errors="errors" :path="path" />
  </div>
</template>

<style scoped>
.path-row {
  display: flex;
  gap: 0.5rem;
  align-items: center;
  flex-wrap: wrap;
}
.path-root {
  flex: 0 0 auto;
  max-width: 18rem;
}
.path-rest {
  flex: 1 1 12rem;
  min-width: 8rem;
}
.path-warning {
  margin: 0 0 0.25rem;
  color: var(--text-italic, #c44);
  font-size: 0.85rem;
}
</style>
