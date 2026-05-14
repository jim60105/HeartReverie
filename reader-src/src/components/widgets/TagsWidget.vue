<script setup lang="ts">
import { computed, ref } from "vue";
import type { WidgetProps } from "./types";
import WidgetErrors from "./WidgetErrors.vue";

const props = defineProps<WidgetProps>();
const emit = defineEmits<(e: "update:modelValue", value: string[]) => void>();

const draft = ref("");

const value = computed<string[]>(() => {
  const v = props.modelValue;
  if (Array.isArray(v)) return v.map((x) => String(x));
  return [];
});

function addTag(raw: string): void {
  const t = raw.trim();
  if (!t) return;
  if (value.value.includes(t)) return;
  emit("update:modelValue", [...value.value, t]);
  draft.value = "";
}

function removeTag(idx: number): void {
  emit(
    "update:modelValue",
    value.value.filter((_, i) => i !== idx),
  );
}

function onKeydown(ev: KeyboardEvent): void {
  if (ev.key === "Enter") {
    ev.preventDefault();
    addTag(draft.value);
  } else if (ev.key === "Backspace" && draft.value === "" && value.value.length > 0) {
    removeTag(value.value.length - 1);
  }
}

const inputId = computed(() => `f-${props.path || "root"}`);
</script>

<template>
  <div class="widget tags-widget">
    <div class="tags-list">
      <span v-for="(tag, idx) in value" :key="idx" class="tag-chip">
        {{ tag }}
        <button type="button" class="tag-remove" @click="removeTag(idx)">×</button>
      </span>
      <input
        :id="inputId"
        v-model="draft"
        type="text"
        class="field-input tag-input"
        placeholder="輸入後按 Enter…"
        @keydown="onKeydown"
      />
    </div>
    <WidgetErrors :errors="errors" :path="path" />
  </div>
</template>

<style scoped>
.tags-list {
  display: flex;
  flex-wrap: wrap;
  gap: 0.35rem;
  align-items: center;
}
.tag-chip {
  display: inline-flex;
  gap: 0.25rem;
  padding: 0.15rem 0.5rem;
  background: var(--bg-tag, #eee);
  border-radius: 999px;
  font-size: 0.85rem;
}
.tag-remove {
  background: none;
  border: 0;
  cursor: pointer;
  font-size: 1rem;
  line-height: 1;
}
.tag-input {
  flex: 1 1 6rem;
  min-width: 6rem;
}
</style>
