<script setup lang="ts">
import { computed } from "vue";
import type { WidgetProps } from "./types";
import WidgetErrors from "./WidgetErrors.vue";
import { useFieldOptions } from "./useFieldOptions";

const props = defineProps<WidgetProps>();
const emit = defineEmits<(e: "update:modelValue", value: string[]) => void>();

const itemsSchema = computed(() => {
  const items = props.schema["items"];
  return items && typeof items === "object" ? (items as Record<string, unknown>) : {};
});

const { options, fetchError } = useFieldOptions(itemsSchema.value);

const value = computed<string[]>(() => {
  const v = props.modelValue;
  if (Array.isArray(v)) return v.map((x) => String(x));
  return [];
});

function toggle(opt: string): void {
  const set = new Set(value.value);
  if (set.has(opt)) set.delete(opt);
  else set.add(opt);
  emit("update:modelValue", Array.from(set));
}

function isSelected(opt: string): boolean {
  return value.value.includes(opt);
}

const inputId = computed(() => `f-${props.path || "root"}`);
</script>

<template>
  <div :id="inputId" class="widget multi-select-widget" role="group">
    <p v-if="fetchError" class="widget-fetch-error">{{ fetchError }}（已使用預設選項）</p>
    <div class="ms-options">
      <label v-for="opt in options" :key="opt.value" class="ms-option">
        <input
          type="checkbox"
          :checked="isSelected(opt.value)"
          :value="opt.value"
          @change="toggle(opt.value)"
        />
        <span>{{ opt.label }}</span>
      </label>
    </div>
    <WidgetErrors :errors="errors" :path="path" />
  </div>
</template>

<style scoped>
.ms-options {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem 1rem;
}
.ms-option {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
}
.widget-fetch-error {
  margin: 0 0 0.25rem;
  color: var(--text-italic, #c44);
  font-size: 0.8rem;
}
</style>
