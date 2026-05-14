<script setup lang="ts">
import { computed } from "vue";
import type { WidgetProps } from "./types";
import WidgetErrors from "./WidgetErrors.vue";

const props = defineProps<WidgetProps>();
const emit = defineEmits<(e: "update:modelValue", value: number | null) => void>();

const isInteger = computed(() => props.schema["type"] === "integer");

const value = computed<number | "">(() => {
  const v = props.modelValue;
  if (typeof v === "number" && Number.isFinite(v)) return v;
  const d = props.schema["default"];
  if (typeof d === "number") return d;
  return "";
});

function onInput(ev: Event): void {
  const raw = (ev.target as HTMLInputElement).value;
  if (raw === "") {
    emit("update:modelValue", null);
    return;
  }
  const n = isInteger.value ? Number.parseInt(raw, 10) : Number.parseFloat(raw);
  if (Number.isFinite(n)) emit("update:modelValue", n);
}

const inputId = computed(() => `f-${props.path || "root"}`);
const min = computed(() =>
  typeof props.schema["minimum"] === "number" ? (props.schema["minimum"] as number) : undefined,
);
const max = computed(() =>
  typeof props.schema["maximum"] === "number" ? (props.schema["maximum"] as number) : undefined,
);
const step = computed(() => {
  if (typeof props.schema["multipleOf"] === "number") {
    return props.schema["multipleOf"] as number;
  }
  return isInteger.value ? 1 : "any";
});
</script>

<template>
  <div class="widget number-widget">
    <input
      :id="inputId"
      type="number"
      class="field-input"
      :value="value"
      :min="min"
      :max="max"
      :step="step"
      @input="onInput"
    />
    <WidgetErrors :errors="errors" :path="path" />
  </div>
</template>
