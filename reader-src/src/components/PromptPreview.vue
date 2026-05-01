<script setup lang="ts">
import { ref, onMounted } from "vue";
import type { ChatMessage, PromptPreviewProps, PromptPreviewResult } from "@/types";
import { useAuth } from "@/composables/useAuth";

const props = defineProps<PromptPreviewProps>();

const { getAuthHeaders } = useAuth();

const loading = ref(false);
const messages = ref<ChatMessage[]>([]);
const metaInfo = ref("");
const errorText = ref("");

const ROLE_LABELS: Record<ChatMessage["role"], string> = {
  system: "系統",
  user: "使用者",
  assistant: "助手",
};

onMounted(() => {
  if (props.series && props.story) {
    fetchPreview();
  } else {
    messages.value = [];
    errorText.value = "尚未選擇故事，無法預覽";
  }
});

defineExpose({ fetchPreview });

async function fetchPreview() {
  loading.value = true;
  errorText.value = "";
  messages.value = [];
  metaInfo.value = "載入中…";

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
      messages.value = [];
      metaInfo.value = "";
      errorText.value = `Error: ${detail}`;
      return;
    }

    const data: PromptPreviewResult = await res.json();
    messages.value = Array.isArray(data.messages) ? data.messages : [];

    const metaParts: string[] = [`Messages: ${messages.value.length}`];
    if (data.fragments?.length) metaParts.push(`Plugins: ${data.fragments.join(", ")}`);
    if (data.variables) metaParts.push(`Chapters: ${data.variables.previous_context ?? ""}`);
    metaInfo.value = metaParts.join(" | ");
  } catch (err) {
    messages.value = [];
    metaInfo.value = "";
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
    <div class="preview-content">
      <div
        v-for="(msg, idx) in messages"
        :key="idx"
        :class="['message-card', `message-card--${msg.role}`]"
      >
        <div class="message-card__header">
          <span :class="['role-badge', `role-badge--${msg.role}`]">
            {{ ROLE_LABELS[msg.role] ?? msg.role }}
          </span>
          <span class="role-key">{{ msg.role }}</span>
        </div>
        <pre class="message-card__body">{{ msg.content }}</pre>
      </div>
      <div v-if="!loading && !errorText && messages.length === 0" class="preview-empty">
        （無訊息）
      </div>
    </div>
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
  min-height: 0;
  margin: 0;
  box-sizing: border-box;
  padding: 16px;
  overflow: auto;
  font-size: 0.85em;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.preview-empty {
  color: var(--text-label);
  font-style: italic;
}

.message-card {
  border: 1px solid var(--border-color);
  border-left-width: 4px;
  border-radius: 6px;
  background: var(--bg-secondary, transparent);
  display: flex;
  flex-direction: column;
}

.message-card--system {
  border-left-color: #888;
}

.message-card--user {
  border-left-color: #4a90e2;
}

.message-card--assistant {
  border-left-color: #50c878;
}

.message-card__header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 12px;
  border-bottom: 1px solid var(--border-color);
}

.role-badge {
  display: inline-block;
  padding: 2px 8px;
  border-radius: 999px;
  font-size: 0.85em;
  font-weight: 600;
  background: var(--bg-tertiary, rgba(127, 127, 127, 0.15));
}

.role-badge--system { color: #888; }
.role-badge--user { color: #4a90e2; }
.role-badge--assistant { color: #50c878; }

.role-key {
  color: var(--text-label);
  font-family: monospace;
  font-size: 0.8em;
}

.message-card__body {
  margin: 0;
  padding: 10px 12px;
  white-space: pre-wrap;
  word-break: break-word;
  font-family: monospace;
}
</style>

