<script setup lang="ts">
import { usePlugins } from "@/composables/usePlugins";
import { useBackground } from "@/composables/useBackground";
import { useFileReader } from "@/composables/useFileReader";
import { useChapterNav } from "@/composables/useChapterNav";
import { useWebSocket } from "@/composables/useWebSocket";
import { useAuth } from "@/composables/useAuth";
import { useRoute } from "vue-router";
import PassphraseGate from "@/components/PassphraseGate.vue";
import "@/styles/base.css";

const route = useRoute();
const { initPlugins } = usePlugins();
const { applyBackground } = useBackground();
const { restoreHandle } = useFileReader();
const { loadFromFSA, loadFromBackend } = useChapterNav();
const { connect } = useWebSocket();
const { passphrase } = useAuth();

async function handleUnlocked() {
  await Promise.all([initPlugins(), applyBackground()]);

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
    return;
  }

  // Otherwise, restore previously saved FSA directory handle
  const restored = await restoreHandle();
  if (restored) {
    const { directoryHandle } = useFileReader();
    if (directoryHandle.value) {
      await loadFromFSA(directoryHandle.value);
    }
  }
}
</script>

<template>
  <PassphraseGate @unlocked="handleUnlocked">
    <router-view />
  </PassphraseGate>
</template>
