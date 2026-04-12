<script setup lang="ts">
import { computed } from "vue";
import type { ChapterContentProps } from "@/types";
import { useMarkdownRenderer } from "@/composables/useMarkdownRenderer";
import OptionsPanel from "./OptionsPanel.vue";
import VariableDisplay from "./VariableDisplay.vue";
import VentoErrorCard from "./VentoErrorCard.vue";

const props = defineProps<ChapterContentProps>();

const emit = defineEmits<{ "option-select": [text: string] }>();

const { renderChapter } = useMarkdownRenderer();

const tokens = computed(() =>
  renderChapter(props.rawMarkdown, { isLastChapter: props.isLastChapter }),
);

function handleOptionSelect(text: string) {
  emit("option-select", text);
}
</script>

<template>
  <div class="chapter-content">
    <template v-for="(token, idx) in tokens" :key="idx">
      <!-- eslint-disable-next-line vue/no-v-html -->
      <div v-if="token.type === 'html'" v-html="token.content"></div>
      <OptionsPanel
        v-else-if="token.type === 'options'"
        :items="token.data"
        @select="handleOptionSelect"
      />
      <VariableDisplay v-else-if="token.type === 'variable'" v-bind="token.data" />
      <VentoErrorCard v-else-if="token.type === 'vento-error'" v-bind="token.data" />
    </template>
  </div>
</template>

<style scoped>
.chapter-content {
  padding: 0 1rem;
}

.chapter-content :deep(p) {
  margin-bottom: 0.8em;
  line-height: 1.8;
  text-shadow: var(--shadow-width) var(--shadow-width) 4px var(--shadow-color);
}

.chapter-content :deep(em) {
  color: var(--text-italic);
}

.chapter-content :deep(u) {
  color: var(--text-underline);
}

.chapter-content :deep(blockquote) {
  border-left: 3px solid var(--text-quote);
  padding-left: 1em;
  color: var(--text-quote);
}

.chapter-content :deep(code) {
  border-radius: 3px;
  background: var(--item-bg);
  padding: 0.1em 0.3em;
  font-size: 0.9em;
}

.chapter-content :deep(hr) {
  margin: 2rem auto;
  border: none;
  border-block-start: 0.1875rem double var(--border-inner);
  overflow: visible;
  text-align: center;
}

.chapter-content :deep(hr)::after {
  position: relative;
  inset-block-start: -1.25rem;
  content: "💕";
  color: var(--border-inner);
  font-size: 1.5rem;
}
</style>
