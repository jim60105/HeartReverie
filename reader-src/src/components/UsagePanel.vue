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
import { computed } from "vue";
import { useUsage } from "@/composables/useUsage";

const { records, totals } = useUsage();

const recentRecords = computed(() => records.value.slice(-10).reverse());

const latest = computed(() => records.value[records.value.length - 1] ?? null);

const summary = computed(() => {
  const total = totals.value.totalTokens;
  if (!latest.value) {
    return `總計：${total} tokens`;
  }
  return `總計：${total} tokens · 最近：${latest.value.promptTokens}+${latest.value.completionTokens}`;
});

function fmt(v: number | null | undefined): string {
  return v === null || v === undefined ? "—" : String(v);
}

function fmtTime(iso: string): string {
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleString();
  } catch {
    return iso;
  }
}
</script>

<template>
  <details class="usage-panel" v-if="totals.count > 0">
    <summary>{{ summary }}</summary>
    <div class="usage-table-wrap">
      <table class="usage-table">
        <thead>
          <tr>
            <th>時間</th>
            <th>章節</th>
            <th>模型</th>
            <th>Prompt</th>
            <th>Completion</th>
            <th>Total</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(r, i) in recentRecords" :key="r.timestamp + ':' + i">
            <td>{{ fmtTime(r.timestamp) }}</td>
            <td>{{ fmt(r.chapter) }}</td>
            <td>{{ r.model || "—" }}</td>
            <td>{{ fmt(r.promptTokens) }}</td>
            <td>{{ fmt(r.completionTokens) }}</td>
            <td>{{ fmt(r.totalTokens) }}</td>
          </tr>
        </tbody>
      </table>
    </div>
  </details>
</template>

<style scoped>
.usage-panel {
  margin: 0.75rem 1rem;
  padding: 0.5rem 0.75rem;
  border: 1px solid var(--border-color, rgba(128, 128, 128, 0.3));
  border-radius: 6px;
  background: var(--panel-bg, rgba(255, 255, 255, 0.04));
  font-size: 0.85rem;
}

.usage-panel > summary {
  cursor: pointer;
  user-select: none;
  opacity: 0.85;
}

.usage-table-wrap {
  margin-top: 0.5rem;
  overflow-x: auto;
}

.usage-table {
  width: 100%;
  border-collapse: collapse;
}

.usage-table th,
.usage-table td {
  text-align: left;
  padding: 0.25rem 0.5rem;
  border-bottom: 1px solid var(--border-color, rgba(128, 128, 128, 0.2));
  white-space: nowrap;
}

.usage-table th {
  font-weight: 600;
  opacity: 0.75;
}
</style>
