<script setup lang="ts">
import type { VariableDisplayProps } from "@/types";

defineProps<VariableDisplayProps>();
</script>

<template>
  <details class="variable-block fold-section">
    <summary class="fold-header">
      <span class="fold-icon">▼</span>
      {{ isComplete ? '變數更新詳情' : '變數更新中...' }}
    </summary>
    <div class="fold-content">
      <pre class="variable-content">{{ content }}</pre>
    </div>
  </details>
</template>
