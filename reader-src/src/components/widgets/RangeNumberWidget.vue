<script setup lang="ts">
import { computed } from "vue";
import type { WidgetProps } from "./types";
import WidgetErrors from "./WidgetErrors.vue";

const props = defineProps<WidgetProps>();
const emit = defineEmits<(e: "update:modelValue", value: number | null) => void>();

const isInteger = computed(() => props.schema["type"] === "integer");

const min = computed<number | undefined>(() => {
  const s = props.schema;
  if (typeof s["minimum"] === "number") return s["minimum"] as number;
  if (typeof s["exclusiveMinimum"] === "number") return (s["exclusiveMinimum"] as number) + (isInteger.value ? 1 : 0);
  return undefined;
});
const max = computed<number | undefined>(() => {
  const s = props.schema;
  if (typeof s["maximum"] === "number") return s["maximum"] as number;
  if (typeof s["exclusiveMaximum"] === "number") return (s["exclusiveMaximum"] as number) - (isInteger.value ? 1 : 0);
  return undefined;
});
const step = computed<number>(() => {
  if (typeof props.schema["multipleOf"] === "number") return props.schema["multipleOf"] as number;
  return isInteger.value ? 1 : 0.01;
});

const value = computed<number>(() => {
  const v = props.modelValue;
  if (typeof v === "number" && Number.isFinite(v)) return v;
  const d = props.schema["default"];
  if (typeof d === "number") return d;
  if (typeof min.value === "number") return min.value;
  return 0;
});

function clamp(n: number): number {
  let x = n;
  if (typeof min.value === "number" && x < min.value) x = min.value;
  if (typeof max.value === "number" && x > max.value) x = max.value;
  return x;
}

function onRangeInput(ev: Event): void {
  const raw = (ev.target as HTMLInputElement).value;
  const n = isInteger.value ? Number.parseInt(raw, 10) : Number.parseFloat(raw);
  if (Number.isFinite(n)) emit("update:modelValue", clamp(n));
}

function onNumberInput(ev: Event): void {
  const raw = (ev.target as HTMLInputElement).value;
  if (raw === "") {
    emit("update:modelValue", null);
    return;
  }
  const n = isInteger.value ? Number.parseInt(raw, 10) : Number.parseFloat(raw);
  if (Number.isFinite(n)) emit("update:modelValue", clamp(n));
}

const inputId = computed(() => `f-${props.path || "root"}`);
</script>

<template>
  <div class="widget range-number-widget">
    <div class="range-row">
      <input
        :id="inputId"
        type="range"
        class="field-range"
        :value="value"
        :min="min"
        :max="max"
        :step="step"
        @input="onRangeInput"
      />
      <input
        type="number"
        class="field-input range-number"
        :value="value"
        :min="min"
        :max="max"
        :step="step"
        @input="onNumberInput"
      />
    </div>
    <WidgetErrors :errors="errors" :path="path" />
  </div>
</template>

<style scoped>
.range-row {
  display: flex;
  gap: 0.75rem;
  align-items: center;
}
.field-range {
  flex: 1 1 auto;
}
.range-number {
  width: 6rem;
}
</style>
