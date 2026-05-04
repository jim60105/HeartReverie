<script setup lang="ts">
import { usePlugins } from "@/composables/usePlugins";
import { useTheme } from "@/composables/useTheme";
import { useChapterNav } from "@/composables/useChapterNav";
import { useWebSocket } from "@/composables/useWebSocket";
import { useAuth } from "@/composables/useAuth";
import { useRoute } from "vue-router";
import PassphraseGate from "@/components/PassphraseGate.vue";
import ToastContainer from "@/components/ToastContainer.vue";
import "@/styles/base.css";

const route = useRoute();
const { initPlugins } = usePlugins();
const { applyOnMount } = useTheme();
const { loadFromBackend } = useChapterNav();
const { connect } = useWebSocket();
const { passphrase } = useAuth();

async function handleUnlocked() {
  await Promise.all([initPlugins(), applyOnMount()]);

  // Connect WebSocket after successful auth
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  connect(`${protocol}//${location.host}/api/ws`, passphrase.value);

  // If the route has series/story params, load from backend
  const series = route.params.series as string | undefined;
  const story = route.params.story as string | undefined;
  if (series && story) {
    const chapterParam = route.params.chapter as string | undefined;
    const startChapter = chapterParam ? parseInt(chapterParam, 10) : undefined;
    await loadFromBackend(series, story, startChapter);
  }
}
</script>

<template>
  <PassphraseGate @unlocked="handleUnlocked">
    <router-view />
  </PassphraseGate>
  <ToastContainer />
</template>
