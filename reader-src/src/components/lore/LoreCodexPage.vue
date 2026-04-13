<script setup lang="ts">
import LoreBrowser from "./LoreBrowser.vue";
</script>

<template>
  <div class="lore-codex-page">
    <LoreBrowser />
  </div>
</template>

<style scoped>
.lore-codex-page {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
}
</style>
