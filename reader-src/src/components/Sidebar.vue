<script setup lang="ts">
</script>

<template>
  <aside class="sidebar">
    <slot />
  </aside>
</template>

<style scoped>
.sidebar {
  position: sticky;
  top: calc(var(--header-height) + 8px);
  max-height: calc(100vh - var(--header-height) - 16px);
  overflow-y: auto;
  scrollbar-width: none;
}

.sidebar::-webkit-scrollbar {
  display: none;
}

.sidebar:empty {
  display: none;
}

@media (max-width: 767px) {
  .sidebar {
    position: static;
    max-height: none;
    overflow-y: visible;
  }
}
</style>
