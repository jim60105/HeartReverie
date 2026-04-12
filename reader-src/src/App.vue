<script setup lang="ts">
import { usePlugins } from "@/composables/usePlugins";
import { useBackground } from "@/composables/useBackground";
import { useFileReader } from "@/composables/useFileReader";
import { useChapterNav } from "@/composables/useChapterNav";
import PassphraseGate from "@/components/PassphraseGate.vue";
import MainLayout from "@/components/MainLayout.vue";
import "@/styles/base.css";

const { initPlugins } = usePlugins();
const { applyBackground } = useBackground();
const { restoreHandle } = useFileReader();
const { loadFromFSA } = useChapterNav();

async function handleUnlocked() {
  await Promise.all([initPlugins(), applyBackground()]);

  // Restore previously saved FSA directory handle
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
    <MainLayout />
  </PassphraseGate>
</template>
