<script setup lang="ts">
import { computed } from "vue";
import type { WidgetProps } from "./types";
import SchemaField from "../SchemaField.vue";

const props = defineProps<WidgetProps>();
const emit = defineEmits<(e: "update:modelValue", value: Record<string, unknown>) => void>();

const value = computed<Record<string, unknown>>(() => {
  const v = props.modelValue;
  if (v && typeof v === "object" && !Array.isArray(v)) return v as Record<string, unknown>;
  return {};
});

const properties = computed(() => {
  const raw = props.schema["properties"];
  if (!raw || typeof raw !== "object") return [];
  return Object.entries(raw as Record<string, Record<string, unknown>>);
});

function childPath(key: string): string {
  return props.path ? `${props.path}.${key}` : key;
}

function onChildUpdate(key: string, v: unknown): void {
  const next: Record<string, unknown> = { ...value.value, [key]: v };
  emit("update:modelValue", next);
}
</script>

<template>
  <fieldset class="widget object-fieldset-widget">
    <SchemaField
      v-for="[key, childSchema] in properties"
      :key="key"
      :schema="childSchema"
      :path="childPath(key)"
      :model-value="value[key]"
      :property-name="key"
      @update:model-value="onChildUpdate(key, $event)"
    />
  </fieldset>
</template>

<style scoped>
.object-fieldset-widget {
  border: 1px solid var(--border-color, #ddd);
  padding: 0.75rem 1rem;
  border-radius: 6px;
  display: flex;
  flex-direction: column;
  gap: 1rem;
  margin: 0;
}
</style>
