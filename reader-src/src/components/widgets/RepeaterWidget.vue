<script setup lang="ts">
import { computed } from "vue";
import type { WidgetProps } from "./types";
import SchemaField from "../SchemaField.vue";
import WidgetErrors from "./WidgetErrors.vue";

const props = defineProps<WidgetProps>();
const emit = defineEmits<(e: "update:modelValue", value: unknown[]) => void>();

const items = computed<unknown[]>(() => {
  const v = props.modelValue;
  if (Array.isArray(v)) return [...v];
  return [];
});

const itemSchema = computed<Record<string, unknown>>(() => {
  const raw = props.schema["items"];
  if (raw && typeof raw === "object") return raw as Record<string, unknown>;
  return {};
});

function childPath(idx: number): string {
  return props.path ? `${props.path}[${idx}]` : `[${idx}]`;
}

function defaultForItem(): unknown {
  const def = itemSchema.value["default"];
  if (def !== undefined) return JSON.parse(JSON.stringify(def));
  const t = itemSchema.value["type"];
  if (t === "object") return {};
  if (t === "array") return [];
  if (t === "boolean") return false;
  if (t === "number" || t === "integer") return 0;
  return "";
}

function onChildUpdate(idx: number, v: unknown): void {
  const next = items.value.slice();
  next[idx] = v;
  emit("update:modelValue", next);
}

function addItem(): void {
  emit("update:modelValue", [...items.value, defaultForItem()]);
}

function removeItem(idx: number): void {
  emit(
    "update:modelValue",
    items.value.filter((_, i) => i !== idx),
  );
}

function moveItem(idx: number, delta: number): void {
  const target = idx + delta;
  if (target < 0 || target >= items.value.length) return;
  const next = items.value.slice();
  const t = next[idx]!;
  next[idx] = next[target]!;
  next[target] = t;
  emit("update:modelValue", next);
}

const maxItems = computed(() =>
  typeof props.schema["maxItems"] === "number" ? (props.schema["maxItems"] as number) : Infinity,
);

const canAdd = computed(() => items.value.length < maxItems.value);
</script>

<template>
  <div class="widget repeater-widget">
    <div v-for="(item, idx) in items" :key="idx" class="repeater-row">
      <div class="repeater-row-header">
        <span class="row-index">#{{ idx + 1 }}</span>
        <button type="button" class="row-btn" :disabled="idx === 0" @click="moveItem(idx, -1)">↑</button>
        <button
          type="button"
          class="row-btn"
          :disabled="idx === items.length - 1"
          @click="moveItem(idx, 1)"
        >↓</button>
        <button type="button" class="row-btn row-delete" @click="removeItem(idx)">刪除</button>
      </div>
      <SchemaField
        :schema="itemSchema"
        :path="childPath(idx)"
        :model-value="item"
        @update:model-value="onChildUpdate(idx, $event)"
      />
    </div>
    <button v-if="canAdd" type="button" class="repeater-add themed-btn" @click="addItem">
      + 新增項目
    </button>
    <WidgetErrors :errors="errors" :path="path" />
  </div>
</template>

<style scoped>
.repeater-widget {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}
.repeater-row {
  border: 1px solid var(--border-color, #ddd);
  border-radius: 6px;
  padding: 0.5rem 0.75rem;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}
.repeater-row-header {
  display: flex;
  gap: 0.5rem;
  align-items: center;
}
.row-index {
  color: var(--text-label, #888);
  font-size: 0.8rem;
}
.row-btn {
  background: none;
  border: 1px solid var(--border-color, #ccc);
  border-radius: 4px;
  padding: 0.15rem 0.5rem;
  cursor: pointer;
  font-size: 0.85rem;
}
.row-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
.row-delete {
  margin-left: auto;
}
.repeater-add {
  align-self: flex-start;
}
</style>
