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
import { onMounted, ref } from "vue";
import { usePromptEditor } from "@/composables/usePromptEditor";
import PromptEditorMessageCard from "./PromptEditorMessageCard.vue";
import type { MessageCard } from "@/types";

const emit = defineEmits<{ preview: []; saved: [] }>();

const {
  cards,
  rawSource,
  useRawFallback,
  parameters,
  isDirty,
  isCustom,
  isSaving,
  parseError,
  topLevelContentDropped,
  saveDisabledReason,
  save,
  loadTemplate,
  resetTemplate,
  toggleRawFallback,
  addCard,
  deleteCard,
  moveCardUp,
  moveCardDown,
  dismissParseError,
} = usePromptEditor();

const rawTextareaRef = ref<HTMLTextAreaElement | null>(null);

onMounted(async () => {
  await loadTemplate();
});

async function handleSave() {
  try {
    await save();
    emit("saved");
  } catch (err) {
    console.error("[PromptEditor] save failed", err);
  }
}

async function handleReset() {
  await resetTemplate();
}

function handlePreview() {
  emit("preview");
}

function onCardRoleUpdate(card: MessageCard, role: MessageCard["role"]) {
  card.role = role;
}

function onCardBodyUpdate(card: MessageCard, body: string) {
  card.body = body;
}

function insertVariableInRaw(varName: string) {
  const ta = rawTextareaRef.value;
  if (!ta) return;
  ta.focus();
  const insertion = `{{ ${varName} }}`;
  const start = ta.selectionStart ?? ta.value.length;
  const end = ta.selectionEnd ?? ta.value.length;
  if (typeof ta.setRangeText === "function") {
    ta.setRangeText(insertion, start, end, "end");
  } else {
    const before = ta.value.slice(0, start);
    const after = ta.value.slice(end);
    ta.value = before + insertion + after;
    ta.selectionStart = ta.selectionEnd = start + insertion.length;
  }
  // Sync v-model: dispatch an `input` event so Vue picks up the change.
  ta.dispatchEvent(new Event("input", { bubbles: true }));
}
</script>

<template>
  <div class="editor-root">
    <div class="editor-toolbar">
      <div class="toolbar-left">
        <label class="toolbar-mode-toggle">
          <input
            type="checkbox"
            :checked="useRawFallback"
            @change="toggleRawFallback"
          />
          <span>{{ useRawFallback ? "結構化模式" : "進階：純文字模式" }}</span>
        </label>
      </div>
      <div class="toolbar-actions">
        <button
          v-if="!useRawFallback"
          class="toolbar-btn"
          title="新增訊息"
          @click="addCard"
        >
          ＋ 新增訊息
        </button>
        <button
          class="toolbar-btn"
          title="回復預設 (system.md)"
          :disabled="!isCustom"
          @click="handleReset"
        >
          ↻ 回復預設
        </button>
        <button
          class="toolbar-btn toolbar-btn--save"
          :title="saveDisabledReason ?? ''"
          :disabled="
            !isDirty || isSaving || (!useRawFallback && saveDisabledReason !== null)
          "
          @click="handleSave"
        >
          <span v-if="isSaving" class="save-spinner">⏳</span>
          {{ isSaving ? "儲存中…" : "儲存" }}
        </button>
        <button class="toolbar-btn toolbar-btn--primary" @click="handlePreview">
          預覽 Prompt
        </button>
      </div>
    </div>

    <div
      v-if="parseError"
      class="editor-banner editor-banner--error"
      role="alert"
    >
      <span class="banner-text">
        範本解析失敗，已切換為純文字模式：{{ parseError }}
      </span>
      <button
        type="button"
        class="banner-dismiss"
        aria-label="關閉"
        @click="dismissParseError"
      >
        ✕
      </button>
    </div>

    <div
      v-if="topLevelContentDropped && !useRawFallback"
      class="editor-banner editor-banner--warning"
      role="status"
    >
      <span class="banner-text">
        範本中有部分內容（訊息區塊之外的文字）將在儲存時被捨棄；如要保留，請使用「進階：純文字模式」
      </span>
    </div>

    <!-- Raw-text fallback mode. The `.editor-textarea-wrap` and
      `.editor-textarea` selectors are part of a CSS contract; do not rename. -->
    <div v-if="useRawFallback" class="editor-textarea-wrap">
      <div
        v-if="parameters.length > 0"
        class="editor-raw-pills"
        role="toolbar"
        aria-label="插入變數"
      >
        <button
          v-for="p in parameters"
          :key="p.name"
          type="button"
          class="editor-raw-pill"
          :class="{
            'pill-core': p.source === 'core',
            'pill-lore': p.source === 'lore',
            'pill-plugin': p.source !== 'core' && p.source !== 'lore',
          }"
          :title="`${p.source}: ${p.type}`"
          @click="insertVariableInRaw(p.name)"
        >
          {{ p.name }}
        </button>
      </div>
      <textarea
        ref="rawTextareaRef"
        v-model="rawSource"
        class="editor-textarea"
        spellcheck="false"
        placeholder="（純文字模式）"
      ></textarea>
    </div>

    <div v-else class="editor-cards-list">
      <PromptEditorMessageCard
        v-for="(card, idx) in cards"
        :key="card.id"
        :card="card"
        :is-first="idx === 0"
        :is-last="idx === cards.length - 1"
        :available-variables="parameters"
        @update:role="(role: MessageCard['role']) => onCardRoleUpdate(card, role)"
        @update:body="(body: string) => onCardBodyUpdate(card, body)"
        @move-up="moveCardUp(card.id)"
        @move-down="moveCardDown(card.id)"
        @delete="deleteCard(card.id)"
      />
      <div v-if="cards.length === 0" class="editor-empty-hint">
        尚無訊息，點擊「＋ 新增訊息」開始撰寫範本。
      </div>
    </div>
  </div>
</template>

<style scoped>
.editor-root {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
  gap: 12px;
}

.editor-toolbar {
  display: flex;
  flex-shrink: 0;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
  border-bottom: 1px solid var(--border-color);
  padding-bottom: 12px;
}

.toolbar-left {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  min-width: 0;
}

.toolbar-mode-toggle {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  cursor: pointer;
  color: var(--text-label);
  font-size: 0.85em;
  font-family: var(--font-antique), var(--font-system-ui);
}

.toolbar-actions {
  display: flex;
  gap: 8px;
  flex-shrink: 0;
}

.toolbar-btn {
  cursor: pointer;
  border: 1px solid var(--btn-border);
  border-radius: 4px;
  background: var(--btn-bg);
  padding: 6px 14px;
  color: var(--text-label);
  font-size: 0.85em;
  font-family: var(--font-antique), var(--font-system-ui);
  transition: background 0.15s, border-color 0.15s;
  white-space: nowrap;
}

.toolbar-btn:hover {
  background: var(--btn-hover-bg);
}

.toolbar-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.toolbar-btn:disabled:hover {
  background: var(--btn-bg);
}

.toolbar-btn--save {
  border-color: #4ade80;
  color: #4ade80;
}

.toolbar-btn--save:not(:disabled):hover {
  background: rgba(74, 222, 128, 0.15);
}

.toolbar-btn--primary {
  border-color: var(--text-title);
  color: var(--text-name);
}

.editor-banner {
  display: flex;
  flex-shrink: 0;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  border-radius: 6px;
  padding: 8px 12px;
  font-size: 0.85em;
  line-height: 1.5;
}

.editor-banner--error {
  border: 1px solid rgba(220, 80, 80, 0.5);
  background: rgba(220, 80, 80, 0.1);
  color: #ff8a8a;
}

.editor-banner--warning {
  border: 1px solid rgba(217, 158, 46, 0.4);
  background: rgba(217, 158, 46, 0.1);
  color: #d4a017;
}

.banner-text {
  flex: 1;
  min-width: 0;
}

.banner-dismiss {
  cursor: pointer;
  border: none;
  background: transparent;
  color: inherit;
  font-size: 1em;
  line-height: 1;
  padding: 0 4px;
}

.editor-textarea-wrap {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
  overflow: hidden;
  gap: 8px;
}

.editor-raw-pills {
  display: flex;
  flex-wrap: wrap;
  flex-shrink: 0;
  gap: 6px;
}

.editor-raw-pill {
  cursor: pointer;
  border: 1px solid var(--item-border);
  border-radius: 999px;
  background: var(--btn-bg);
  padding: 3px 10px;
  color: var(--text-label);
  font-size: 0.75em;
  font-family: monospace;
  transition: background 0.15s, border-color 0.15s;
  white-space: nowrap;
}

.editor-raw-pill:hover {
  background: var(--btn-hover-bg);
}

.editor-raw-pill.pill-core {
  border-color: rgba(74, 163, 255, 0.5);
  color: #4aa3ff;
}

.editor-raw-pill.pill-lore {
  border-color: rgba(217, 158, 46, 0.5);
  color: #d4a017;
}

.editor-raw-pill.pill-plugin {
  border-color: rgba(74, 222, 128, 0.5);
  color: #4ade80;
}

.editor-textarea {
  border: 1px solid var(--item-border);
  border-radius: 6px;
  background: rgba(0, 0, 0, 0.3);
  padding: 12px;
  width: 100%;
  height: 100%;
  resize: none;
  color: var(--text-main);
  font-size: 0.85em;
  line-height: 1.5;
  font-family: monospace;
  tab-size: 2;
  box-sizing: border-box;
}

.editor-textarea:focus {
  outline: none;
  border-color: var(--text-title);
}

.editor-cards-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding-right: 4px;
}

.editor-empty-hint {
  color: var(--text-label);
  font-size: 0.85em;
  font-style: italic;
  padding: 24px 12px;
  text-align: center;
  border: 1px dashed var(--item-border);
  border-radius: 6px;
}
</style>
