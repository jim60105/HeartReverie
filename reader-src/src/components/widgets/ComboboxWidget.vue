<script setup lang="ts">
import { computed } from "vue";
import type { WidgetProps } from "./types";
import WidgetErrors from "./WidgetErrors.vue";
import { useFieldOptions } from "./useFieldOptions";

const props = defineProps<WidgetProps>();
const emit = defineEmits<(e: "update:modelValue", value: string) => void>();

const { options, fetchError } = useFieldOptions(props.schema, props.context.getAuthHeaders);

const value = computed(() => {
  const v = props.modelValue;
  if (v === null || v === undefined) return "";
  return typeof v === "string" ? v : String(v);
});

function onInput(ev: Event): void {
  emit("update:modelValue", (ev.target as HTMLInputElement).value);
}

const inputId = computed(() => `f-${props.path || "root"}`);
const listId = computed(() => `dl-${props.path || "root"}`);
</script>

<template>
  <div class="widget combobox-widget">
    <p v-if="fetchError" class="widget-fetch-error">{{ fetchError }}（已使用預設選項）</p>
    <input
      :id="inputId"
      type="text"
      class="field-input"
      :value="value"
      :list="listId"
      autocomplete="off"
      @input="onInput"
    />
    <datalist :id="listId">
      <option v-for="opt in options" :key="opt.value" :value="opt.value">{{ opt.label }}</option>
    </datalist>
    <WidgetErrors :errors="errors" :path="path" />
  </div>
</template>

<style scoped>
.widget-fetch-error {
  margin: 0 0 0.25rem;
  color: var(--text-italic, #c44);
  font-size: 0.8rem;
}
</style>
