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
import { computed, ref } from "vue";
import type { TemplateRef } from "@/lib/template-api";

const props = defineProps<{
  entries: TemplateRef[];
  selected: string | null;
}>();

const emit = defineEmits<{
  select: [templatePath: string];
}>();

const expanded = ref<Set<string>>(new Set([
  "system",
  "plugins",
  "lore",
  "lore:global",
  "lore:series",
  "lore:story",
]));

function isExpanded(key: string): boolean {
  return expanded.value.has(key);
}

function toggle(key: string): void {
  const next = new Set(expanded.value);
  if (next.has(key)) {
    next.delete(key);
  } else {
    next.add(key);
  }
  expanded.value = next;
}

const systemEntries = computed(() => props.entries.filter((e) => e.kind === "system"));
const pluginEntries = computed(() => props.entries.filter((e) => e.kind === "plugin-fragment"));
const loreEntries = computed(() => props.entries.filter((e) => e.kind === "lore"));

interface PluginGroup {
  pluginName: string;
  /** zh-TW label from plugin manifest; falls back to the slug if missing. */
  pluginDisplayName: string;
  items: TemplateRef[];
}

const pluginGroups = computed<PluginGroup[]>(() => {
  const map = new Map<string, { displayName: string; items: TemplateRef[] }>();
  for (const entry of pluginEntries.value) {
    const name = entry.pluginName ?? "unknown";
    const bucket = map.get(name) ?? {
      displayName: entry.pluginDisplayName ?? name,
      items: [],
    };
    // First non-empty displayName seen wins; defensive against partial payloads.
    if (!bucket.displayName && entry.pluginDisplayName) {
      bucket.displayName = entry.pluginDisplayName;
    }
    bucket.items.push(entry);
    map.set(name, bucket);
  }
  return Array.from(map.entries())
    .sort(([, a], [, b]) => a.displayName.localeCompare(b.displayName))
    .map(([pluginName, { displayName, items }]) => ({
      pluginName,
      pluginDisplayName: displayName,
      items,
    }));
});

interface LoreGroup {
  scope: "global" | "series" | "story";
  label: string;
  items: TemplateRef[];
}

const loreGroups = computed<LoreGroup[]>(() => {
  const buckets: Record<LoreGroup["scope"], TemplateRef[]> = {
    global: [],
    series: [],
    story: [],
  };
  for (const entry of loreEntries.value) {
    const s = entry.loreScope ?? "global";
    buckets[s].push(entry);
  }
  return [
    { scope: "global", label: "全域 (global)", items: buckets.global },
    { scope: "series", label: "系列 (series)", items: buckets.series },
    { scope: "story", label: "章節 (story)", items: buckets.story },
  ];
});

function onSelect(entry: TemplateRef): void {
  emit("select", entry.templatePath);
}
</script>

<template>
  <nav class="template-tree" aria-label="模板列表">
    <!-- System -->
    <section class="tree-section">
      <button
        type="button"
        class="section-header"
        :aria-expanded="isExpanded('system')"
        @click="toggle('system')"
      >
        <span class="caret">{{ isExpanded('system') ? '▾' : '▸' }}</span>
        <span>系統提示詞</span>
      </button>
      <ul v-if="isExpanded('system')" class="tree-list">
        <li v-for="entry in systemEntries" :key="entry.templatePath">
          <button
            type="button"
            class="tree-leaf"
            :class="{ 'is-selected': selected === entry.templatePath }"
            :title="entry.templatePath"
            @click="onSelect(entry)"
          >
            {{ entry.path }}
          </button>
        </li>
      </ul>
    </section>

    <!-- Plugin Fragments (read-only) -->
    <section class="tree-section">
      <button
        type="button"
        class="section-header"
        :aria-expanded="isExpanded('plugins')"
        @click="toggle('plugins')"
      >
        <span class="caret">{{ isExpanded('plugins') ? '▾' : '▸' }}</span>
        <span>Plugin Fragments</span>
      </button>
      <div v-if="isExpanded('plugins')">
        <div v-for="group in pluginGroups" :key="group.pluginName" class="plugin-group">
          <div class="section-sub-header section-sub-header--label" :title="group.pluginName">
            <span>{{ group.pluginDisplayName }}</span>
          </div>
          <ul class="tree-list">
            <li v-for="entry in group.items" :key="entry.templatePath">
              <button
                type="button"
                class="tree-leaf tree-leaf--readonly"
                :class="{ 'is-selected': selected === entry.templatePath }"
                :title="entry.templatePath"
                @click="onSelect(entry)"
              >
                <span class="leaf-label">{{ entry.path }}</span>
                <span class="badge-readonly">唯讀</span>
              </button>
            </li>
          </ul>
        </div>
        <div v-if="!pluginGroups.length" class="tree-empty">（無 plugin fragment）</div>
      </div>
    </section>

    <!-- Lore -->
    <section class="tree-section">
      <button
        type="button"
        class="section-header"
        :aria-expanded="isExpanded('lore')"
        @click="toggle('lore')"
      >
        <span class="caret">{{ isExpanded('lore') ? '▾' : '▸' }}</span>
        <span>Lore 篇章</span>
      </button>
      <div v-if="isExpanded('lore')">
        <div v-for="group in loreGroups" :key="group.scope" class="lore-group">
          <button
            type="button"
            class="section-sub-header"
            :aria-expanded="isExpanded('lore:' + group.scope)"
            @click="toggle('lore:' + group.scope)"
          >
            <span class="caret">{{ isExpanded('lore:' + group.scope) ? '▾' : '▸' }}</span>
            <span>{{ group.label }}</span>
            <span class="count">({{ group.items.length }})</span>
          </button>
          <ul v-if="isExpanded('lore:' + group.scope) && group.items.length" class="tree-list">
            <li v-for="entry in group.items" :key="entry.templatePath">
              <button
                type="button"
                class="tree-leaf"
                :class="{ 'is-selected': selected === entry.templatePath }"
                :title="entry.templatePath"
                @click="onSelect(entry)"
              >
                {{ entry.path }}
              </button>
            </li>
          </ul>
        </div>
      </div>
    </section>
  </nav>
</template>

<style scoped>
.template-tree {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 12px 8px;
  overflow-y: auto;
  font-family: var(--font-antique), var(--font-system-ui);
  font-size: 0.85rem;
}

.tree-section {
  display: flex;
  flex-direction: column;
}

.section-header,
.section-sub-header {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 4px 6px;
  border: none;
  background: transparent;
  color: var(--text-title);
  font: inherit;
  text-align: left;
  cursor: pointer;
}

.section-header {
  font-weight: 600;
}

.section-sub-header {
  padding-left: 16px;
  color: var(--text-label);
  font-size: 0.8rem;
}

.section-header:hover,
.section-sub-header:hover {
  background: var(--accent-subtle);
}

.caret {
  display: inline-block;
  width: 12px;
  color: var(--text-quote);
}

.count {
  margin-left: auto;
  color: var(--text-label);
  font-size: 0.75rem;
}

.tree-list {
  list-style: none;
  margin: 0;
  padding: 0 0 0 24px;
}

.tree-leaf {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 4px 8px;
  border: 1px solid transparent;
  border-radius: 3px;
  background: transparent;
  color: var(--text-label);
  font: inherit;
  text-align: left;
  cursor: pointer;
}

.tree-leaf:hover {
  background: var(--btn-bg);
  border-color: var(--btn-border);
}

.tree-leaf.is-selected {
  background: var(--accent-subtle);
  border-color: var(--accent-solid);
  color: var(--text-title);
}

.leaf-label {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.badge-readonly {
  flex-shrink: 0;
  padding: 1px 6px;
  border-radius: 999px;
  background: var(--pill-bg);
  color: var(--text-quote);
  font-size: 0.7rem;
  letter-spacing: 0.05em;
}

.tree-empty {
  padding: 4px 24px;
  color: var(--text-label);
  font-style: italic;
  font-size: 0.8rem;
}
</style>
