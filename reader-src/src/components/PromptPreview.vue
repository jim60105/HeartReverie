<script setup lang="ts">
import { ref, onMounted } from "vue";
import type { PromptPreviewProps, PromptPreviewResult } from "@/types";
import { useAuth } from "@/composables/useAuth";

const props = defineProps<PromptPreviewProps>();

const emit = defineEmits<{ close: [] }>();

const { getAuthHeaders } = useAuth();

const loading = ref(false);
const previewContent = ref("");
const metaInfo = ref("");
const errorText = ref("");

onMounted(() => {
  fetchPreview();
});

async function fetchPreview() {
  loading.value = true;
  errorText.value = "";
  previewContent.value = "Loading...";
  metaInfo.value = "";

  try {
    const body: Record<string, string> = {
      message: props.message || "(preview)",
    };
    if (typeof props.template === "string") {
      body.template = props.template;
    }

    const res = await fetch(
      `/api/stories/${encodeURIComponent(props.series)}/${encodeURIComponent(props.story)}/preview-prompt`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", ...getAuthHeaders() },
        body: JSON.stringify(body),
      },
    );

    if (!res.ok) {
      const err = await res.json();
      previewContent.value = "";
      errorText.value = `Error: ${err.message || err.detail || "Unknown error"}`;
      return;
    }

    const data: PromptPreviewResult = await res.json();
    previewContent.value = data.prompt;

    const metaParts: string[] = [];
    if (data.fragments?.length) metaParts.push(`Plugins: ${data.fragments.join(", ")}`);
    if (data.variables) metaParts.push(`Chapters: ${data.variables.previous_context ?? ""}`);
    metaInfo.value = metaParts.join(" | ");
  } catch (err) {
    previewContent.value = "";
    errorText.value = `Error: ${err instanceof Error ? err.message : "Unknown error"}`;
  } finally {
    loading.value = false;
  }
}
</script>

<template>
  <div class="prompt-preview-panel">
    <div class="preview-header">
      <h3>📝 Prompt Preview</h3>
      <button class="preview-close-btn" @click="emit('close')">✕</button>
    </div>
    <div v-if="metaInfo" class="preview-meta">{{ metaInfo }}</div>
    <div v-if="errorText" class="preview-error">{{ errorText }}</div>
    <pre class="preview-content">{{ previewContent }}</pre>
  </div>
</template>

<style scoped>
.prompt-preview-panel {
  display: flex;
  position: fixed;
  top: 0;
  left: 0;
  flex-direction: column;
  z-index: 1000;
  border-right: 1px solid var(--border-color);
  background: linear-gradient(145deg, #1a0810, #220c16);
  width: 33vw;
  height: 100vh;
  overflow: hidden;
}

@media (max-width: 767px) {
  .prompt-preview-panel {
    width: 100vw;
  }
}

.preview-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  border-bottom: 1px solid var(--border-color);
  padding: 12px 16px;
}

.preview-close-btn {
  cursor: pointer;
  border: none;
  background: none;
  color: inherit;
  font-size: 1.2em;
}

.preview-meta {
  padding: 8px 16px;
  color: var(--text-label);
  font-size: 0.85em;
}

.preview-error {
  padding: 8px 16px;
  color: #ff6b6b;
  font-size: 0.85em;
}

.preview-content {
  flex: 1;
  padding: 16px;
  overflow: auto;
  font-size: 0.85em;
  white-space: pre-wrap;
  word-break: break-word;
}
</style>
