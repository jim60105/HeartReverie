<!--
  Copyright (C) 2026 Jim Chen <Jim@ChenJ.im>, licensed under AGPL-3.0-or-later

  This program is free software: you can redistribute it and/or modify
  it under the terms of the GNU AFFERO GENERAL PUBLIC LICENSE as published by
  the Free Software Foundation, either version 3 of the License, or
  (at your option) any later version.

  This program is distributed in the hope that it will be useful,
  but WITHOUT ANY WARRANTY; without even the implied warranty of
  MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
  GNU AFFERO GENERAL PUBLIC LICENSE for more details.

  You should have received a copy of the GNU AFFERO GENERAL PUBLIC LICENSE
  along with this program.  If not, see <https://www.gnu.org/licenses/>.
-->
<script setup lang="ts">
import { ref } from "vue";
import type { MessageCard, ParameterPill } from "@/types";

interface Props {
  card: MessageCard;
  isFirst: boolean;
  isLast: boolean;
  availableVariables?: ParameterPill[];
}

const props = withDefaults(defineProps<Props>(), {
  availableVariables: () => [],
});

const emit = defineEmits<{
  "update:role": [role: MessageCard["role"]];
  "update:body": [body: string];
  "move-up": [];
  "move-down": [];
  delete: [];
}>();

const ROLE_OPTIONS: Array<{ value: MessageCard["role"]; label: string }> = [
  { value: "system", label: "系統" },
  { value: "user", label: "使用者" },
  { value: "assistant", label: "助理" },
];

const textareaRef = ref<HTMLTextAreaElement | null>(null);
const showVariableMenu = ref(false);
const showDeleteConfirm = ref(false);

function onRoleChange(event: Event) {
  const next = (event.target as HTMLSelectElement).value as MessageCard["role"];
  emit("update:role", next);
}

function onBodyInput(event: Event) {
  emit("update:body", (event.target as HTMLTextAreaElement).value);
}

function insertAtCursor(varName: string) {
  const ta = textareaRef.value;
  if (!ta) return;
  ta.focus();
  const insertion = `{{ ${varName} }}`;
  if (typeof ta.setRangeText === "function") {
    const start = ta.selectionStart ?? ta.value.length;
    const end = ta.selectionEnd ?? ta.value.length;
    ta.setRangeText(insertion, start, end, "end");
    emit("update:body", ta.value);
  } else {
    // Fallback for environments without setRangeText.
    const start = ta.selectionStart ?? ta.value.length;
    const end = ta.selectionEnd ?? ta.value.length;
    const before = ta.value.slice(0, start);
    const after = ta.value.slice(end);
    const next = before + insertion + after;
    ta.value = next;
    ta.selectionStart = ta.selectionEnd = start + insertion.length;
    emit("update:body", next);
  }
  showVariableMenu.value = false;
}

function startDelete() {
  showDeleteConfirm.value = true;
}

function cancelDelete() {
  showDeleteConfirm.value = false;
}

function confirmDelete() {
  showDeleteConfirm.value = false;
  emit("delete");
}
</script>

<template>
  <div class="message-card" :class="`role-${props.card.role}`">
    <div class="card-header">
      <label class="card-sender">
        <span class="card-label">傳送者</span>
        <select
          class="card-role-select"
          :value="props.card.role"
          @change="onRoleChange"
        >
          <option
            v-for="opt in ROLE_OPTIONS"
            :key="opt.value"
            :value="opt.value"
          >
            {{ opt.label }}
          </option>
        </select>
      </label>
      <span class="card-role-badge">{{ props.card.role }}</span>
      <div class="card-actions">
        <button
          type="button"
          class="card-action-btn"
          aria-label="上移"
          title="上移"
          :disabled="props.isFirst"
          @click="emit('move-up')"
        >
          ↑
        </button>
        <button
          type="button"
          class="card-action-btn"
          aria-label="下移"
          title="下移"
          :disabled="props.isLast"
          @click="emit('move-down')"
        >
          ↓
        </button>
        <button
          type="button"
          class="card-action-btn card-action-delete"
          aria-label="刪除"
          title="刪除"
          @click="startDelete"
        >
          ✕
        </button>
      </div>
    </div>

    <div v-if="showDeleteConfirm" class="card-confirm">
      <p class="card-confirm-text">確定刪除這則訊息？</p>
      <div class="card-confirm-actions">
        <button
          type="button"
          class="card-confirm-btn card-confirm-cancel"
          @click="cancelDelete"
        >
          取消
        </button>
        <button
          type="button"
          class="card-confirm-btn card-confirm-confirm"
          @click="confirmDelete"
        >
          確定
        </button>
      </div>
    </div>

    <div v-else class="card-body-wrap">
      <div class="card-variable-helper">
        <button
          type="button"
          class="card-helper-btn"
          @click="showVariableMenu = !showVariableMenu"
        >
          插入變數 ▾
        </button>
        <div v-if="showVariableMenu" class="card-variable-menu">
          <button
            v-for="p in props.availableVariables"
            :key="p.name"
            type="button"
            class="card-variable-item"
            :class="{
              'pill-core': p.source === 'core',
              'pill-lore': p.source === 'lore',
              'pill-plugin': p.source !== 'core' && p.source !== 'lore',
            }"
            :title="`${p.source}: ${p.type}`"
            @click="insertAtCursor(p.name)"
          >
            {{ p.name }}
          </button>
          <p
            v-if="!props.availableVariables.length"
            class="card-variable-empty"
          >
            （目前沒有可用的變數）
          </p>
        </div>
      </div>

      <textarea
        ref="textareaRef"
        class="card-body"
        spellcheck="false"
        :value="props.card.body"
        placeholder="（訊息內容）"
        @input="onBodyInput"
      ></textarea>
    </div>
  </div>
</template>

<style scoped>
.message-card {
  display: flex;
  flex-direction: column;
  gap: 8px;
  border: 1px solid var(--item-border);
  border-radius: 8px;
  background: rgba(0, 0, 0, 0.18);
  padding: 12px;
}

.message-card.role-system {
  border-left: 3px solid var(--border-color, #888);
}

.message-card.role-user {
  border-left: 3px solid #4aa3ff;
}

.message-card.role-assistant {
  border-left: 3px solid #4ade80;
}

.card-header {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 12px;
}

.card-sender {
  display: flex;
  align-items: center;
  gap: 6px;
}

.card-label {
  color: var(--text-label);
  font-size: 0.8em;
  font-family: var(--font-antique), var(--font-system-ui);
}

.card-role-select {
  border: 1px solid var(--item-border);
  border-radius: 4px;
  background: var(--btn-bg);
  padding: 4px 8px;
  color: var(--text-main);
  font-size: 0.85em;
  font-family: inherit;
}

.card-role-badge {
  border: 1px solid var(--item-border);
  border-radius: 12px;
  padding: 1px 8px;
  color: var(--text-name);
  font-size: 0.75em;
  font-family: monospace;
  text-transform: lowercase;
}

.card-actions {
  display: flex;
  gap: 4px;
  margin-left: auto;
}

.card-action-btn {
  cursor: pointer;
  border: 1px solid var(--btn-border);
  border-radius: 4px;
  background: var(--btn-bg);
  padding: 2px 8px;
  color: var(--text-label);
  font-size: 0.95em;
  font-family: inherit;
  line-height: 1.2;
}

.card-action-btn:hover:not(:disabled) {
  background: var(--btn-hover-bg);
}

.card-action-btn:disabled {
  opacity: 0.35;
  cursor: not-allowed;
}

.card-action-delete {
  border-color: rgba(220, 80, 80, 0.5);
  color: #ff8080;
}

.card-confirm {
  display: flex;
  flex-direction: column;
  gap: 8px;
  border: 1px solid rgba(220, 80, 80, 0.5);
  border-radius: 6px;
  background: rgba(220, 80, 80, 0.08);
  padding: 12px;
}

.card-confirm-text {
  margin: 0;
  color: var(--text-main);
  font-size: 0.9em;
}

.card-confirm-actions {
  display: flex;
  gap: 8px;
  justify-content: flex-end;
}

.card-confirm-btn {
  cursor: pointer;
  border: 1px solid var(--btn-border);
  border-radius: 4px;
  background: var(--btn-bg);
  padding: 4px 14px;
  color: var(--text-label);
  font-size: 0.85em;
  font-family: inherit;
}

.card-confirm-confirm {
  border-color: rgba(220, 80, 80, 0.6);
  color: #ff8a8a;
}

.card-body-wrap {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.card-variable-helper {
  position: relative;
  align-self: flex-start;
}

.card-helper-btn {
  cursor: pointer;
  border: 1px solid var(--btn-border);
  border-radius: 4px;
  background: var(--btn-bg);
  padding: 2px 10px;
  color: var(--text-label);
  font-size: 0.8em;
  font-family: inherit;
}

.card-variable-menu {
  display: flex;
  position: absolute;
  z-index: 5;
  flex-wrap: wrap;
  gap: 4px;
  margin-top: 4px;
  border: 1px solid var(--item-border);
  border-radius: 6px;
  background: rgba(0, 0, 0, 0.85);
  padding: 6px;
  max-width: 360px;
}

.card-variable-item {
  cursor: pointer;
  border: 1px solid var(--item-border);
  border-radius: 12px;
  background: rgba(224, 80, 112, 0.12);
  padding: 2px 8px;
  color: var(--text-name);
  font-size: 0.75em;
  font-family: monospace;
}

.card-variable-item.pill-plugin {
  border-color: rgba(180, 30, 60, 0.6);
  background: rgba(180, 30, 60, 0.12);
  color: var(--text-label);
}

.card-variable-item.pill-lore {
  border-color: rgba(217, 158, 46, 0.3);
  background: rgba(217, 158, 46, 0.15);
  color: #d4a017;
}

.card-variable-empty {
  margin: 0;
  color: var(--text-label);
  font-size: 0.75em;
}

.card-body {
  border: 1px solid var(--item-border);
  border-radius: 6px;
  background: rgba(0, 0, 0, 0.3);
  padding: 8px;
  width: 100%;
  min-height: 96px;
  resize: vertical;
  color: var(--text-main);
  font-size: 0.85em;
  line-height: 1.5;
  font-family: monospace;
  tab-size: 2;
  box-sizing: border-box;
}

.card-body:focus {
  outline: none;
  border-color: var(--text-title);
}
</style>
