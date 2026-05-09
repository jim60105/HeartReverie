<script setup lang="ts">
import { useChatApi } from "@/composables/useChatApi";

const { isLoading } = useChatApi();
</script>

<template>
  <aside
    class="sidebar"
    :class="{ 'sidebar--hidden-during-stream': isLoading }"
  >
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

.sidebar.sidebar--hidden-during-stream {
  visibility: hidden;
  opacity: 0;
  pointer-events: none;
}

@media (max-width: 767px) {
  .sidebar {
    position: static;
    max-height: none;
    overflow-y: visible;
  }

  .sidebar.sidebar--hidden-during-stream {
    display: none;
  }
}
</style>

