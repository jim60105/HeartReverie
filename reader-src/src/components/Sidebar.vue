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
/* position: sticky with no anchor edge scrolls with the document rather than
   pinning to the viewport. overflow-y and scrollbar rules are intentionally
   absent: without a height cap they would be dead code and overflow-y would
   create a BFC scroll container that silently breaks descendant sticky elements. */
.sidebar {
  position: sticky;
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
