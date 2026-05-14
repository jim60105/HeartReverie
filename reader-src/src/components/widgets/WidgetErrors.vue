<script setup lang="ts">
import { formatValidationError } from "@/lib/validation-i18n";
import type { ValidationError } from "@/lib/validation-i18n";

defineProps<{
  errors: ValidationError[];
  path: string;
}>();
</script>

<template>
  <ul v-if="errors && errors.length" class="widget-errors" :data-error-path="path">
    <li v-for="(e, i) in errors" :key="i" class="widget-error">
      {{ formatValidationError(e) }}
    </li>
  </ul>
</template>

<style scoped>
.widget-errors {
  margin: 0.25rem 0 0;
  padding-left: 1.25rem;
  list-style: disc;
  color: var(--text-italic, #c44);
  font-size: 0.85rem;
}
</style>
