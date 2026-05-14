<script setup lang="ts">
import { computed } from "vue";
import type { WidgetProps } from "./types";
import WidgetErrors from "./WidgetErrors.vue";

const props = defineProps<WidgetProps>();
const emit = defineEmits<(e: "update:modelValue", value: boolean) => void>();

const checked = computed(() => {
  const v = props.modelValue;
  if (typeof v === "boolean") return v;
  return props.schema["default"] === true;
});

function onChange(ev: Event): void {
  emit("update:modelValue", (ev.target as HTMLInputElement).checked);
}

const inputId = computed(() => `f-${props.path || "root"}`);
</script>

<template>
  <div class="widget checkbox-widget">
    <input
      :id="inputId"
      type="checkbox"
      class="field-checkbox"
      :checked="checked"
      @change="onChange"
    />
    <WidgetErrors :errors="errors" :path="path" />
  </div>
</template>
