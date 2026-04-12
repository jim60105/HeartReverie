<script setup lang="ts">
import { ref } from "vue";
import type { OptionItem } from "@/types";

defineProps<{ items: OptionItem[] }>();

const emit = defineEmits<{ select: [text: string] }>();

const copiedIndex = ref<number | null>(null);

function handleClick(item: OptionItem) {
  navigator.clipboard.writeText(item.text).catch(() => {});
  copiedIndex.value = item.number;
  setTimeout(() => {
    copiedIndex.value = null;
  }, 1000);
  emit("select", item.text);
}

const cells = [0, 1, 2, 3];
</script>

<template>
  <div class="options-panel era-actions-container">
    <div class="era-actions-header">
      <h4 class="era-actions-title">✦ 行動選項 ✦</h4>
      <div class="header-line"></div>
    </div>
    <div class="era-action-buttons">
      <template v-for="i in cells" :key="i">
        <button
          v-if="i < items.length"
          class="era-action-btn"
          @click="handleClick(items[i]!)"
        >
          <template v-if="copiedIndex === items[i]!.number">
            已複製!
          </template>
          <template v-else>
            <span class="era-action-num">{{ items[i]!.number }}.</span> {{ items[i]!.text }}
          </template>
        </button>
        <div v-else class="era-action-btn era-action-btn--empty"></div>
      </template>
    </div>
  </div>
</template>
