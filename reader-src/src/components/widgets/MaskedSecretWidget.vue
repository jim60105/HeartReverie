<script setup lang="ts">
import { computed, ref, watch } from "vue";
import type { WidgetProps } from "./types";
import WidgetErrors from "./WidgetErrors.vue";

const props = defineProps<WidgetProps>();
const emit = defineEmits<(e: "update:modelValue", value: string | null) => void>();

// `null` from server = secret stored but masked. Display placeholder.
// User-typed "" emits "" (clear). Other string emits new value.

const showSecret = ref(false);
const draft = ref<string>("");

watch(
  () => props.modelValue,
  (v) => {
    if (v === null || v === undefined) draft.value = "";
    else if (typeof v === "string") draft.value = v;
  },
  { immediate: true },
);

const placeholder = computed(() =>
  props.modelValue === null ? "（已儲存，留空保持不變）" : "輸入新密鑰…",
);

const inputType = computed(() => (showSecret.value ? "text" : "password"));
const inputId = computed(() => `f-${props.path || "root"}`);

function onInput(ev: Event): void {
  const raw = (ev.target as HTMLInputElement).value;
  draft.value = raw;
  // empty string when server holds a value means "keep" only if we never typed:
  // Per spec D3: null = keep, "" = clear, other = set. We emit the literal value.
  if (raw === "" && props.modelValue === null) {
    // user has not actually typed anything yet → keep as null
    emit("update:modelValue", null);
    return;
  }
  emit("update:modelValue", raw);
}

function clearSecret(): void {
  draft.value = "";
  emit("update:modelValue", "");
}

function toggleShow(): void {
  showSecret.value = !showSecret.value;
}
</script>

<template>
  <div class="widget masked-secret-widget">
    <div class="masked-row">
      <input
        :id="inputId"
        :type="inputType"
        class="field-input"
        :value="draft"
        :placeholder="placeholder"
        autocomplete="off"
        @input="onInput"
      />
      <button
        type="button"
        class="toggle-btn themed-btn"
        @click="toggleShow"
      >
        {{ showSecret ? "隱藏" : "顯示" }}
      </button>
      <button
        v-if="modelValue === null || (typeof modelValue === 'string' && modelValue.length > 0)"
        type="button"
        class="clear-btn themed-btn"
        @click="clearSecret"
      >
        清除
      </button>
    </div>
    <p v-if="modelValue === null" class="masked-hint">(已儲存)</p>
    <WidgetErrors :errors="errors" :path="path" />
  </div>
</template>

<style scoped>
.masked-row {
  display: flex;
  gap: 0.5rem;
  align-items: center;
  flex-wrap: wrap;
}
.masked-row .field-input {
  flex: 1 1 12rem;
  min-width: 12rem;
}
.masked-hint {
  margin: 0.25rem 0 0;
  color: var(--text-label, #888);
  font-size: 0.8rem;
}
</style>
