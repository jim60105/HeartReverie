<script setup lang="ts">
import type { StatusBarProps } from "@/types";

const props = defineProps<StatusBarProps>();

const infoRows = computed(() => {
  const rows: { emoji: string; label: string; value: string; class: string }[] = [];
  if (props.scene) rows.push({ emoji: "📍", label: "場景:", value: props.scene, class: "scene-box" });
  if (props.thought) rows.push({ emoji: "💭", label: "想法:", value: props.thought, class: "plain-box" });
  if (props.items) rows.push({ emoji: "👜", label: "物品:", value: props.items, class: "plain-box" });
  return rows;
});

const outfitItems = computed(() => {
  const items: { emoji: string; label: string; value: string }[] = [];
  if (props.clothes) items.push({ emoji: "👚", label: "衣物", value: props.clothes });
  if (props.shoes) items.push({ emoji: "🧦", label: "鞋襪", value: props.shoes });
  if (props.socks) items.push({ emoji: "💍", label: "襪類", value: props.socks });
  if (props.accessories) items.push({ emoji: "⛓️", label: "飾品", value: props.accessories });
  return items;
});

import { computed } from "vue";
</script>

<template>
  <div class="status-panel main-card status-float">
    <div v-if="name || title" class="char-header">
      <div v-if="name" class="char-name">{{ name }}</div>
      <div v-if="title" class="char-title">{{ title }}</div>
    </div>

    <div v-if="infoRows.length" class="stats-container">
      <div class="grid-info">
        <div
          v-for="row in infoRows"
          :key="row.label"
          class="info-item"
          :class="row.class"
        >
          <span class="emoji-icon">{{ row.emoji }}</span>
          <span v-if="row.class !== 'plain-box'" class="item-label">{{ row.label }}</span>
          <span v-else class="item-label">{{ row.emoji === '💭' ? '' : '' }}{{ row.label }}</span>
          <span class="stat-val">{{ row.value }}</span>
        </div>
      </div>
    </div>

    <details v-if="outfitItems.length" class="fold-section status-details" open>
      <summary class="fold-header">
        <span class="fold-icon">▼</span> 👗 穿着
      </summary>
      <div class="fold-content">
        <div class="grid-info two-col">
          <div v-for="item in outfitItems" :key="item.label" class="info-item">
            <span class="emoji-icon">{{ item.emoji }}</span>
            <div>
              <span class="item-label">{{ item.label }}:</span>
              <span class="stat-val">{{ item.value }}</span>
            </div>
          </div>
        </div>
      </div>
    </details>

    <details v-if="closeUps.length" class="fold-section status-details" open>
      <summary class="fold-header">
        <span class="fold-icon">▼</span> 🔍 特寫
      </summary>
      <div class="fold-content">
        <div v-for="cu in closeUps" :key="cu.part" class="stat-row">
          <span class="stat-label">{{ cu.part }}:</span>
          <span class="stat-val">{{ cu.description }}</span>
        </div>
      </div>
    </details>
  </div>
</template>
