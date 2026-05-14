<script setup lang="ts">
import type { HandlerInfo } from "@/types";

defineProps<{ handler: HandlerInfo }>();
</script>

<template>
  <div class="handler-row">
    <span class="handler-row__priority">P{{ handler.priority }}</span>
    <span class="handler-row__plugin">{{ handler.plugin ?? "(unbound)" }}</span>
    <span v-if="(handler.reads ?? []).length" class="badge badge--reads">
      reads: {{ (handler.reads ?? []).join(", ") }}
    </span>
    <span v-if="(handler.writes ?? []).length" class="badge badge--writes">
      writes: {{ (handler.writes ?? []).join(", ") }}
    </span>
    <span
      v-if="handler.errorCount > 0"
      class="badge badge--errors"
      title="自上次重啟以來"
    >
      ⚠ {{ handler.errorCount }} 次錯誤 · 自上次重啟以來
    </span>
    <span v-if="handler.note" class="handler-row__note">{{ handler.note }}</span>
  </div>
</template>

<style scoped>
.handler-row {
  display: flex;
  gap: 8px;
  align-items: baseline;
  flex-wrap: wrap;
  padding: 4px 0;
  font-size: 0.875rem;
}
.handler-row__priority { font-variant-numeric: tabular-nums; opacity: 0.75; }
.handler-row__plugin { font-weight: 600; }
.handler-row__note { opacity: 0.7; font-style: italic; }
.badge {
  font-size: 0.75rem;
  padding: 1px 6px;
  border-radius: 999px;
  background: var(--btn-bg);
  border: 1px solid var(--btn-border);
}
.badge--reads { background: var(--pill-bg); border-color: var(--btn-border); }
.badge--writes { background: var(--accent-subtle); border-color: var(--accent-border); }
.badge--errors {
  background: rgba(220, 38, 38, 0.15);
  border-color: var(--accent-solid);
  color: var(--accent-solid);
}
</style>
