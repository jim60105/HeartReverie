<script setup lang="ts">
import { usePlugins } from "@/composables/usePlugins";
import { useBackground } from "@/composables/useBackground";
import PassphraseGate from "@/components/PassphraseGate.vue";
import MainLayout from "@/components/MainLayout.vue";
import "@/styles/base.css";

const { initPlugins } = usePlugins();
const { applyBackground } = useBackground();

async function handleUnlocked() {
  await Promise.all([initPlugins(), applyBackground()]);
}
</script>

<template>
  <PassphraseGate @unlocked="handleUnlocked">
    <MainLayout />
  </PassphraseGate>
</template>
