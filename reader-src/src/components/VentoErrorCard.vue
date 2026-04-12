<script setup lang="ts">
import type { VentoErrorCardProps } from "@/types";

defineProps<VentoErrorCardProps>();
</script>

<template>
  <div class="vento-error-card">
    <div class="vento-error-header">⚠️ 模板渲染錯誤</div>
    <div class="vento-error-body">
      <div class="vento-error-message">{{ message }}</div>
      <div v-if="source" class="vento-error-source">
        檔案: {{ source }}<template v-if="line"> (行 {{ line }})</template>
      </div>
      <div v-if="suggestion" class="vento-error-suggestion">
        💡 {{ suggestion }}
      </div>
    </div>
  </div>
</template>
