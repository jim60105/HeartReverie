<script setup lang="ts">
import { ref, computed } from "vue";
import { useChapterNav } from "@/composables/useChapterNav";
import PromptEditor from "./PromptEditor.vue";
import PromptPreview from "./PromptPreview.vue";

const { getBackendContext } = useChapterNav();

const showPreview = ref(false);
const previewRef = ref<InstanceType<typeof PromptPreview> | null>(null);

const previewContext = computed(() => {
  const ctx = getBackendContext();
  return {
    series: ctx.series ?? "",
    story: ctx.story ?? "",
  };
});

function togglePreview() {
  showPreview.value = !showPreview.value;
}

function handleSaved() {
  if (showPreview.value) {
    previewRef.value?.fetchPreview();
  }
}
</script>

<template>
  <!--
    The `.editor-page` class is part of a global layout contract: the rule
    `.settings-layout.settings-layout:has(.editor-page)` in
    `src/styles/base.css` pins the settings shell to the viewport so the
    textarea + preview become the only scroll containers on this route.
    Renaming or removing this class will break independent-pane scrolling.
  -->
  <div class="editor-page">
    <div class="editor-page-main">
      <PromptEditor @preview="togglePreview" @saved="handleSaved" />
    </div>
    <div v-if="showPreview" class="editor-page-preview">
      <PromptPreview
        ref="previewRef"
        :series="previewContext.series"
        :story="previewContext.story"
        message="(preview)"
      />
    </div>
  </div>
</template>

<style scoped>
.editor-page {
  display: flex;
  gap: 16px;
  flex: 1;
  min-height: 0;
}

.editor-page-main {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
}

.editor-page-preview {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  border-left: 1px solid var(--border-color);
}

@media (max-width: 767px) {
  .editor-page {
    flex-direction: column;
  }

  .editor-page-preview {
    border-left: none;
    border-top: 1px solid var(--border-color);
  }
}
</style>
