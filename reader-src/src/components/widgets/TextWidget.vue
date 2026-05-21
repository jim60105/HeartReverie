<script setup lang="ts">
import { computed } from "vue";
import type { WidgetProps } from "./types";
import WidgetErrors from "./WidgetErrors.vue";

const props = defineProps<WidgetProps>();
const emit = defineEmits<(e: "update:modelValue", value: string) => void>();

const value = computed(() => {
  const v = props.modelValue;
  if (v === null || v === undefined) {
    const d = props.schema["default"];
    return typeof d === "string" ? d : "";
  }
  return typeof v === "string" ? v : String(v);
});

function onInput(ev: Event): void {
  emit("update:modelValue", (ev.target as HTMLInputElement).value);
}

const inputId = computed(() => `f-${props.path || "root"}`);
const inputMode = computed<"email" | "url" | undefined>(() =>
  props.schema["format"] === "email"
    ? "email"
    : props.schema["format"] === "url"
      ? "url"
      : undefined,
);
const minLength = computed(() =>
  typeof props.schema["minLength"] === "number"
    ? (props.schema["minLength"] as number)
    : undefined,
);
const maxLength = computed(() =>
  typeof props.schema["maxLength"] === "number"
    ? (props.schema["maxLength"] as number)
    : undefined,
);
</script>

<template>
  <div class="widget text-widget">
    <input
      :id="inputId"
      type="text"
      class="field-input"
      :value="value"
      :minlength="minLength"
      :maxlength="maxLength"
      :inputmode="inputMode"
      @input="onInput"
    />
    <WidgetErrors :errors="errors" :path="path" />
  </div>
</template>
