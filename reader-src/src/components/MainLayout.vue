<script setup lang="ts">
import { ref, computed, onMounted } from "vue";
import { useRoute } from "vue-router";
import { useChapterNav } from "@/composables/useChapterNav";
import AppHeader from "./AppHeader.vue";
import ContentArea from "./ContentArea.vue";
import ChatInput from "./ChatInput.vue";
import UsagePanel from "./UsagePanel.vue";
import PluginActionBar from "./PluginActionBar.vue";
import { useChatApi } from "@/composables/useChatApi";

const route = useRoute();
const { isLastChapter, chapters, chapterCount, latestChapterIsEmpty, getBackendContext, reloadToLast } = useChapterNav();
const { sendMessage, resendMessage, continueLastChapter } = useChatApi();

const chatInputKey = computed(() =>
  `${route.params.series ?? ""}:${route.params.story ?? ""}`
);

const chatInputRef = ref<InstanceType<typeof ChatInput> | null>(null);

const showChatInput = computed(() => {
  const ctx = getBackendContext();
  return ctx.isBackendMode && (isLastChapter.value || chapters.value.length === 0);
});

async function handleSend(message: string) {
  const ctx = getBackendContext();
  if (!ctx.series || !ctx.story) return;

  const success = await sendMessage(ctx.series, ctx.story, message);
  if (success) {
    await reloadToLast();
  }
}

async function handleResend(message: string) {
  const ctx = getBackendContext();
  if (!ctx.series || !ctx.story) return;

  const success = await resendMessage(ctx.series, ctx.story, message);
  if (success) {
    await reloadToLast();
  }
}

async function handleContinue() {
  const ctx = getBackendContext();
  if (!ctx.series || !ctx.story) return;

  const success = await continueLastChapter(ctx.series, ctx.story);
  if (success) {
    await reloadToLast();
  }
}

function handleOptionSelect(text: string) {
  chatInputRef.value?.appendText(text);
}

// Listen for plugin-dispatched option-selected custom DOM events
onMounted(() => {
  document.addEventListener("option-selected", ((e: CustomEvent<{ text: string }>) => {
    if (e.detail?.text) {
      handleOptionSelect(e.detail.text);
    }
  }) as EventListener);
});
</script>

<template>
  <div class="main-layout">
    <AppHeader />
    <main class="main-content">
      <ContentArea />
      <UsagePanel />
      <PluginActionBar v-if="showChatInput" />
      <ChatInput
        v-if="showChatInput"
        :key="chatInputKey"
        ref="chatInputRef"
        :chapter-count="chapterCount"
        :latest-chapter-is-empty="latestChapterIsEmpty"
        @send="handleSend"
        @resend="handleResend"
        @continue="handleContinue"
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
