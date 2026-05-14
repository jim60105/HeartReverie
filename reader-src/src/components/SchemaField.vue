<script setup lang="ts">
import { computed, inject } from "vue";
import { FormContextKey } from "@/lib/widget-registry";
import type { FormContextValue, JsonSchema } from "@/lib/widget-registry";
import { evaluateShowWhen } from "./schema-field-helpers";

interface Props {
  schema: JsonSchema;
  path: string;
  modelValue: unknown;
  // Used for label rendering when this field is rendered as a property of an
  // object-fieldset parent. May be empty when this is the root.
  propertyName?: string;
}

const props = defineProps<Props>();
const emit = defineEmits<(e: "update:modelValue", value: unknown) => void>();

const context = inject<FormContextValue | null>(FormContextKey, null);

if (!context) {
  // happens in malformed tests; we render a hint instead of throwing during render
  console.warn("[SchemaField] FormContext was not provided");
}

const descriptor = computed(() => {
  if (!context) return null;
  return context.registry.resolve(props.schema);
});

const scopedErrors = computed(() => {
  if (!context) return [];
  const p = props.path;
  return context.errors.filter((e) => {
    if (!p) return true;
    if (e.path === p) return true;
    return e.path.startsWith(`${p}.`) || e.path.startsWith(`${p}[`);
  });
});

const visible = computed<boolean>(() => {
  const showWhen = props.schema["x-show-when"];
  if (!showWhen) return true;
  if (!context) return true;
  return evaluateShowWhen(showWhen, props.path, context.rootModel);
});

const label = computed<string>(() => {
  const t = props.schema["title"];
  if (typeof t === "string" && t) return t;
  return props.propertyName ?? "";
});

const description = computed<string>(() => {
  const d = props.schema["description"];
  return typeof d === "string" ? d : "";
});

function onUpdate(v: unknown): void {
  emit("update:modelValue", v);
}

// Show inline error if no context (test harness will see the message).
const widgetComponent = computed(() => descriptor.value?.component ?? null);
</script>

<template>
  <div v-if="visible" class="schema-field" :data-path="path">
    <label v-if="label" :for="`f-${path || 'root'}`" class="field-label">{{ label }}</label>
    <p v-if="description" class="field-description">{{ description }}</p>
    <component
      :is="widgetComponent"
      v-if="widgetComponent && context"
      :schema="schema"
      :path="path"
      :model-value="modelValue"
      :errors="scopedErrors"
      :context="context"
      @update:model-value="onUpdate"
    />
    <p v-else class="field-error">無法解析欄位元件</p>
  </div>
</template>

<style scoped>
.schema-field {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
}
.field-label {
  font-weight: 600;
  font-size: 0.95rem;
}
.field-description {
  margin: 0;
  color: var(--text-label, #888);
  font-size: 0.8rem;
  white-space: pre-line;
}
.field-error {
  color: var(--text-italic, #c44);
}
</style>
