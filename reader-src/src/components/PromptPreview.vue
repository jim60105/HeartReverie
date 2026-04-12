<script setup lang="ts">
import { ref, onMounted } from "vue";
import type { PromptPreviewProps, PromptPreviewResult } from "@/types";
import { useAuth } from "@/composables/useAuth";

const props = defineProps<PromptPreviewProps>();

const { getAuthHeaders } = useAuth();

const loading = ref(false);
const previewContent = ref("");
const metaInfo = ref("");
const errorText = ref("");

onMounted(() => {
  if (props.series && props.story) {
    fetchPreview();
  } else {
    previewContent.value = "";
    errorText.value = "尚未選擇故事，無法預覽";
  }
});

defineExpose({ fetchPreview });

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
      let detail = `HTTP ${res.status}`;
      try {
        const err = await res.json();
        detail = err.message || err.detail || detail;
      } catch {
        /* non-JSON error response */
      }
      previewContent.value = "";
      errorText.value = `Error: ${detail}`;
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
  <div class="preview-root">
    <div class="preview-header">
      <h3>📝 Prompt Preview</h3>
    </div>
    <div v-if="metaInfo" class="preview-meta">{{ metaInfo }}</div>
    <div v-if="errorText" class="preview-error">{{ errorText }}</div>
    <pre class="preview-content">{{ previewContent }}</pre>
  </div>
</template>

<style scoped>
.preview-root {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
  overflow: hidden;
}

.preview-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  border-bottom: 1px solid var(--border-color);
  padding: 12px 16px;
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
