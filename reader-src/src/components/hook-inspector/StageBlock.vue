<script setup lang="ts">
import { computed } from "vue";
import type { ConflictReport, HandlerInfo } from "@/types";
import HandlerRow from "./HandlerRow.vue";

const props = defineProps<{
  stage: string;
  handlers: HandlerInfo[];
  conflicts: ConflictReport[];
}>();

const sortedHandlers = computed(() =>
  [...props.handlers].sort((a, b) => a.priority - b.priority)
);
</script>

<template>
  <details class="stage-block" open>
    <summary class="stage-block__summary">
      <span class="stage-block__name">{{ stage }}</span>
      <span class="stage-block__count">({{ handlers.length }} handler{{ handlers.length === 1 ? "" : "s" }})</span>
      <span v-if="conflicts.length" class="stage-block__conflicts">
        ⚠ {{ conflicts.length }} 衝突
      </span>
    </summary>
    <div class="stage-block__body">
      <HandlerRow
        v-for="(h, idx) in sortedHandlers"
        :key="`${h.plugin ?? '?'}::${h.priority}::${idx}`"
        :handler="h"
      />
      <ul v-if="conflicts.length" class="stage-block__conflict-list">
        <li v-for="(c, i) in conflicts" :key="i">
          <strong>{{ c.kind }}</strong>: {{ c.message }}
        </li>
      </ul>
    </div>
  </details>
</template>

<style scoped>
.stage-block {
  border: 1px solid var(--border-color);
  border-radius: 4px;
  padding: 8px 12px;
}
.stage-block__summary {
  display: flex;
  gap: 8px;
  align-items: baseline;
  cursor: pointer;
  font-family: var(--font-antique), var(--font-system-ui);
}
.stage-block__name { font-weight: 600; }
.stage-block__count { opacity: 0.6; font-size: 0.85rem; }
.stage-block__conflicts { color: var(--text-quote); font-size: 0.85rem; }
.stage-block__body { margin-top: 8px; display: flex; flex-direction: column; gap: 4px; }
.stage-block__conflict-list { margin-top: 8px; font-size: 0.85rem; color: var(--text-quote); }
</style>
