<!--
  Copyright (C) 2026 Jim Chen <Jim@ChenJ.im>, licensed under AGPL-3.0-or-later

  This program is free software: you can redistribute it and/or modify
  it under the terms of the GNU AFFERO GENERAL PUBLIC LICENSE as published by
  the Free Software Foundation, either version 3 of the License, or
  (at your option) any later version.

  This program is distributed in the hope that it will be useful,
  but WITHOUT ANY WARRANTY; without even the implied warranty of
  MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
  GNU AFFERO GENERAL PUBLIC LICENSE for more details.

  You should have received a copy of the GNU AFFERO GENERAL PUBLIC LICENSE
  along with this program. If not, see <https://www.gnu.org/licenses/>.
-->
<script setup lang="ts">
import { usePluginActions } from "@/composables/usePluginActions";

const { actionButtons, pendingKey, clickButton } = usePluginActions();

function isPending(pluginName: string, id: string): boolean {
  return pendingKey.value === `${pluginName}:${id}`;
}
</script>

<template>
  <div v-if="actionButtons.length > 0" class="plugin-action-bar">
    <button
      v-for="btn in actionButtons"
      :key="`${btn.pluginName}:${btn.id}`"
      type="button"
      class="plugin-action-btn"
      :title="btn.tooltip"
      :disabled="isPending(btn.pluginName, btn.id)"
      @click="clickButton(btn.id, btn.pluginName)"
    >
      <span v-if="btn.icon" class="plugin-action-icon">{{ btn.icon }}</span>
      <span class="plugin-action-label">{{ btn.label }}</span>
    </button>
  </div>
</template>

<style scoped>
.plugin-action-bar {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  margin: 0.5rem 1rem 0.75rem;
  padding: 0.5rem 0.75rem;
  border: 1px solid var(--border-color, rgba(128, 128, 128, 0.3));
  border-radius: 6px;
  background: var(--panel-bg, rgba(255, 255, 255, 0.04));
}

.plugin-action-btn {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  padding: 0.35rem 0.75rem;
  border: 1px solid var(--border-color, rgba(128, 128, 128, 0.3));
  border-radius: 4px;
  background: transparent;
  color: inherit;
  cursor: pointer;
  font-size: 0.9rem;
  line-height: 1.2;
}

.plugin-action-btn:hover:not(:disabled) {
  background: var(--panel-bg-hover, rgba(255, 255, 255, 0.08));
}

.plugin-action-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.plugin-action-icon {
  font-size: 1rem;
}
</style>
