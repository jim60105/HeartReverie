<script setup lang="ts">
import { ref } from "vue";
import type { ChatInputProps } from "@/types";
import { useChatApi } from "@/composables/useChatApi";

defineProps<ChatInputProps>();

const emit = defineEmits<{
  send: [message: string];
  resend: [message: string];
}>();

const { isLoading, errorMessage, streamingContent } = useChatApi();

const inputText = ref("");
const isResending = ref(false);

function handleSend() {
  const message = inputText.value.trim();
  if (!message) {
    errorMessage.value = "請輸入故事指令";
    return;
  }
  errorMessage.value = "";
  isResending.value = false;
  emit("send", message);
}

function handleResend() {
  const message = inputText.value.trim();
  if (!message) {
    errorMessage.value = "請輸入故事指令";
    return;
  }
  errorMessage.value = "";
  isResending.value = true;
  emit("resend", message);
}

function handleKeydown(e: KeyboardEvent) {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    handleSend();
  }
}

function appendText(text: string) {
  const current = inputText.value;
  inputText.value = current ? `${current}\n${text}` : text;
}

defineExpose({ appendText });
</script>

<template>
  <div class="chat-input-area">
    <div class="chat-input-card">
      <textarea
        v-model="inputText"
        rows="3"
        placeholder="輸入故事指令…"
        class="chat-textarea"
        :disabled="disabled || isLoading"
        @keydown="handleKeydown"
      ></textarea>
      <div class="chat-actions">
        <slot name="tools" />
        <span class="chat-spacer"></span>
        <span v-if="errorMessage" class="chat-error">{{ errorMessage }}</span>
        <button
          class="themed-btn chat-btn"
          :disabled="disabled || isLoading"
          @click="handleResend"
        >
          {{ isLoading && isResending ? '⏳ 重送中…' : '🔄 重送' }}
        </button>
        <button
          class="themed-btn chat-btn"
          :disabled="disabled || isLoading"
          @click="handleSend"
        >
          {{ isLoading && !isResending ? '⏳ 發送中…' : '✨ 發送' }}
        </button>
      </div>
    </div>
    <div
      v-if="isLoading && streamingContent"
      class="streaming-preview"
    >{{ streamingContent }}</div>
  </div>
</template>

<style scoped>
.chat-input-area {
  max-width: 48rem;
  margin: 1rem auto;
  padding: 0 1rem;
}

.chat-input-card {
  background: var(--panel-bg);
  border: 1px solid var(--border-color);
  border-radius: 12px;
  padding: 12px;
}

.chat-textarea {
  width: 100%;
  resize: vertical;
  background: var(--item-bg);
  border: 1px solid var(--item-border);
  border-radius: 8px;
  padding: 8px;
  color: var(--text-main);
  font-family: var(--font-system-ui);
  font-size: var(--font-base);
  box-sizing: border-box;
}

.chat-textarea:focus {
  outline: none;
  border-color: var(--text-title);
}

.chat-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 8px;
  align-items: center;
}

.chat-spacer {
  flex: 1;
}

.chat-error {
  color: #ff6b6b;
  font-size: 0.875rem;
  align-self: center;
}

.chat-btn {
  background: var(--btn-bg);
  border: 1px solid var(--btn-border);
  color: var(--text-name);
  padding: 4px 16px;
  border-radius: 4px;
  font-size: 0.875rem;
  font-weight: 500;
  cursor: pointer;
  transition: background 0.15s, border-color 0.15s;
}

.chat-btn:disabled {
  opacity: 0.3;
  cursor: not-allowed;
}

.streaming-preview {
  margin-top: 8px;
  padding: 10px 12px;
  background: color-mix(in srgb, var(--panel-bg) 80%, transparent);
  border: 1px solid var(--border-color);
  border-radius: 8px;
  color: var(--text-main);
  font-size: 0.875rem;
  line-height: 1.5;
  white-space: pre-wrap;
  word-break: break-word;
  max-height: 12rem;
  overflow-y: auto;
}
</style>
