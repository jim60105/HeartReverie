<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from "vue";
import { useChapterNav } from "@/composables/useChapterNav";
import { usePromptEditor } from "@/composables/usePromptEditor";
import AppHeader from "./AppHeader.vue";
import ContentArea from "./ContentArea.vue";
import ChatInput from "./ChatInput.vue";
import { useChatApi } from "@/composables/useChatApi";

const { isLastChapter, chapters, getBackendContext, reloadToLast } = useChapterNav();
const { savedTemplate } = usePromptEditor();
const { sendMessage, resendMessage } = useChatApi();

const chatInputRef = ref<InstanceType<typeof ChatInput> | null>(null);

const showChatInput = computed(() => {
  const ctx = getBackendContext();
  return ctx.isBackendMode && (isLastChapter.value || chapters.value.length === 0);
});

async function handleSend(message: string) {
  const ctx = getBackendContext();
  if (!ctx.series || !ctx.story) return;

  const tpl = savedTemplate.value;
  const success = await sendMessage(ctx.series, ctx.story, message, tpl);
  if (success) {
    await reloadToLast();
  }
}

async function handleResend(message: string) {
  const ctx = getBackendContext();
  if (!ctx.series || !ctx.story) return;

  const tpl = savedTemplate.value;
  const success = await resendMessage(ctx.series, ctx.story, message, tpl);
  if (success) {
    await reloadToLast();
  }
}

function handleOptionSelect(text: string) {
  chatInputRef.value?.appendText(text);
}

// Listen for plugin-dispatched option-selected custom DOM events
function handlePluginOptionSelect(e: Event) {
  const detail = (e as CustomEvent<{ text: string }>).detail;
  if (detail?.text) {
    chatInputRef.value?.appendText(detail.text);
  }
}

onMounted(() => {
  document.addEventListener("option-selected", handlePluginOptionSelect);
});

onUnmounted(() => {
  document.removeEventListener("option-selected", handlePluginOptionSelect);
});
</script>

<template>
  <div class="main-layout">
    <AppHeader />
    <main class="main-content">
      <ContentArea @option-select="handleOptionSelect" />
      <ChatInput
        v-if="showChatInput"
        ref="chatInputRef"
        @send="handleSend"
        @resend="handleResend"
      >
        <template #tools>
          <!-- Tool buttons can be slotted here by parent -->
        </template>
      </ChatInput>
    </main>
  </div>
</template>

<style scoped>
.main-layout {
  display: flex;
  flex-direction: column;
  min-height: 100vh;
}

.main-content {
  flex: 1;
  padding: 1rem 1rem 1.5rem;
}
</style>
