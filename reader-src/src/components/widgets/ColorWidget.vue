<script setup lang="ts">
import { computed } from "vue";
import type { WidgetProps } from "./types";
import WidgetErrors from "./WidgetErrors.vue";

const props = defineProps<WidgetProps>();
const emit = defineEmits<(e: "update:modelValue", value: string) => void>();

const value = computed<string>(() => {
  const v = props.modelValue;
  if (typeof v === "string" && /^#?[0-9a-fA-F]{3,8}$/.test(v)) {
    return v.startsWith("#") ? v : `#${v}`;
  }
  const d = props.schema["default"];
  return typeof d === "string" ? d : "#000000";
});

function onInput(ev: Event): void {
  emit("update:modelValue", (ev.target as HTMLInputElement).value);
}

const inputId = computed(() => `f-${props.path || "root"}`);
</script>

<template>
  <div class="widget color-widget">
    <input
      :id="inputId"
      type="color"
      class="field-color"
      :value="value"
      @input="onInput"
    />
    <input
      type="text"
      class="field-input color-text"
      :value="value"
      @input="onInput"
    />
    <WidgetErrors :errors="errors" :path="path" />
  </div>
</template>

<style scoped>
.color-widget {
  display: flex;
  gap: 0.5rem;
  align-items: center;
  flex-wrap: wrap;
}
.color-text {
  flex: 1 1 8rem;
  min-width: 8rem;
}
</style>
