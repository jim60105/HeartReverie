<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from "vue";
import type { ChatInputProps } from "@/types";
import { useChatApi } from "@/composables/useChatApi";
import { useChapterNav } from "@/composables/useChapterNav";
import { useChatInput } from "@/composables/useChatInput";
import { useAutoresize } from "@/composables/useAutoresize";

const props = withDefaults(defineProps<ChatInputProps>(), {
  disabled: false,
  chapterCount: 0,
  latestChapterIsEmpty: true,
});

const emit = defineEmits<{
  send: [message: string];
  resend: [message: string];
  continue: [];
}>();

const { isLoading, errorMessage, streamingContent, abortCurrentRequest } = useChatApi();
const { getBackendContext } = useChapterNav();
// The textarea text is owned by the shared, story-aware `useChatInput()`
// singleton so other reader code (the plugin action bar) can read the live
// value — including text typed but not yet sent. This component binds its
// `v-model` to the shared ref and delegates persistence/append to it.
const { inputText, persistText, appendText: appendShared, syncToStory } = useChatInput();

// Seed the shared input from this story's persisted draft synchronously during
// setup — before the first render — so the textarea reflects the active story
// immediately. `syncToStory` reseeds only when the active story key changes
// (e.g. after a story-scoped `:key` remount); the composable's own watch keeps
// it current even without a remount.
{
  const ctx = getBackendContext();
  syncToStory(ctx.series, ctx.story);
}

const isResending = ref(false);
const chatTextareaRef = ref<HTMLTextAreaElement | null>(null);
const { recompute: recomputeChatHeight } = useAutoresize(chatTextareaRef, { minLines: 3 });

onMounted(() => {
  // After the persisted draft is restored, fit the textarea to its content.
  void nextTick().then(() => recomputeChatHeight());
});

// When the active story changes without a component remount, the shared
// composable reseeds `inputText` from the new story's persisted draft. Refit
// the textarea afterwards so a restored multi-line draft is fully visible.
watch(
  () => {
    const ctx = getBackendContext();
    return `${ctx.series ?? ""}:${ctx.story ?? ""}`;
  },
  (next, prev) => {
    if (next === prev) return;
    const ctx = getBackendContext();
    syncToStory(ctx.series, ctx.story);
    void nextTick().then(() => recomputeChatHeight());
  },
);

function onPaste() {
  // Pasted text is inserted by the browser default action; the RAF batching
  // inside useAutoresize ensures measurement happens after the insertion.
  recomputeChatHeight();
}

function onInput(event: Event) {
  // Defence-in-depth: some browsers may surface paste only via input events.
  const inputType = (event as InputEvent).inputType;
  if (inputType === "insertFromPaste") {
    recomputeChatHeight();
  }
}

function handleSend() {
  const message = inputText.value.trim();
  if (!message) {
    errorMessage.value = "請輸入故事指令";
    return;
  }
  errorMessage.value = "";
  isResending.value = false;
  persistText(inputText.value);
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
  persistText(inputText.value);
  emit("resend", message);
}

function handleKeydown(e: KeyboardEvent) {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    handleSend();
  }
}

const continueDisabled = computed(() =>
  props.disabled || isLoading.value || props.chapterCount === 0 || props.latestChapterIsEmpty,
);

const continueTooltip = computed(() => {
  if (isLoading.value) return "生成進行中…";
  if (props.disabled) return "目前無法續寫";
  if (props.chapterCount === 0) return "尚無章節可續寫";
  if (props.latestChapterIsEmpty) return "最後一章為空，無法續寫";
  return "從最後一章繼續往下生成";
});

function handleContinue() {
  if (continueDisabled.value) return;
  errorMessage.value = "";
  // Do NOT clear inputText — user may have typed a future message.
  emit("continue");
}

function appendText(text: string) {
  // Delegate the newline-prepend rule to the shared composable, then refit.
  appendShared(text);
  // Wait for v-model to flush the new value into the DOM before measuring.
  void nextTick().then(() => recomputeChatHeight());
}

defineExpose({ appendText });
</script>

<template>
  <div class="chat-input-area">
    <div class="chat-input-card">
      <textarea
        ref="chatTextareaRef"
        v-model="inputText"
        rows="3"
        placeholder="輸入故事指令…"
        class="chat-textarea"
        :disabled="disabled || isLoading"
        @keydown="handleKeydown"
        @paste="onPaste"
        @input="onInput"
      ></textarea>
      <div class="chat-actions">
        <slot name="tools" />
        <span class="chat-spacer"></span>
        <span v-if="errorMessage" class="chat-error">{{ errorMessage }}</span>
        <button
          class="themed-btn chat-btn chat-btn-continue"
          :disabled="continueDisabled"
          :title="continueTooltip"
          @click="handleContinue"
        >
          ⏭ 續寫
        </button>
        <button
          class="themed-btn chat-btn"
          :disabled="disabled || isLoading"
          @click="handleResend"
        >
          {{ isLoading && isResending ? '⏳ 重送中…' : '🔄 重送' }}
        </button>
        <button
          v-if="isLoading"
          class="themed-btn chat-btn chat-btn-stop"
          @click="abortCurrentRequest"
        >
          ⏹ 停止
        </button>
        <button
          v-else
          class="themed-btn chat-btn"
          :disabled="disabled"
          @click="handleSend"
        >
          ✨ 發送
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

.chat-btn-stop {
  background: #dc2626;
  border-color: #b91c1c;
  color: #fff;
}

.chat-btn-stop:hover {
  background: #ef4444;
  border-color: #dc2626;
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
