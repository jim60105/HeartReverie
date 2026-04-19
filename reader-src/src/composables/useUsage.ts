// Copyright (C) 2026 Jim Chen <Jim@ChenJ.im>, licensed under AGPL-3.0-or-later
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU AFFERO GENERAL PUBLIC LICENSE as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
// GNU AFFERO GENERAL PUBLIC LICENSE for more details.
//
// You should have received a copy of the GNU AFFERO GENERAL PUBLIC LICENSE
// along with this program. If not, see <https://www.gnu.org/licenses/>.

import { ref } from "vue";
import { useAuth } from "@/composables/useAuth";
import type {
  TokenUsageRecord,
  UsageTotals,
  UseUsageReturn,
} from "@/types";

const records = ref<TokenUsageRecord[]>([]);
const totals = ref<UsageTotals>({
  promptTokens: 0,
  completionTokens: 0,
  totalTokens: 0,
  count: 0,
});
const currentKey = ref<string>("");

/** Monotonically increasing request token to detect stale loads. */
let loadSeq = 0;

function keyOf(series: string, story: string): string {
  return `${series}/${story}`;
}

function recomputeTotals(): void {
  let p = 0;
  let c = 0;
  let t = 0;
  for (const r of records.value) {
    p += r.promptTokens;
    c += r.completionTokens;
    t += r.totalTokens;
  }
  totals.value = {
    promptTokens: p,
    completionTokens: c,
    totalTokens: t,
    count: records.value.length,
  };
}

async function load(series: string, story: string): Promise<void> {
  const { getAuthHeaders } = useAuth();
  const seq = ++loadSeq;
  const key = keyOf(series, story);
  try {
    const res = await fetch(
      `/api/stories/${encodeURIComponent(series)}/${encodeURIComponent(story)}/usage`,
      { headers: { ...getAuthHeaders() } },
    );
    // Discard if a newer load was issued while awaiting
    if (seq !== loadSeq) return;
    if (!res.ok) {
      records.value = [];
      recomputeTotals();
      currentKey.value = key;
      return;
    }
    const body = (await res.json()) as {
      records?: TokenUsageRecord[];
      totals?: UsageTotals;
    };
    // Discard again after json parse
    if (seq !== loadSeq) return;
    records.value = Array.isArray(body.records) ? body.records : [];
    if (body.totals) {
      totals.value = body.totals;
    } else {
      recomputeTotals();
    }
    currentKey.value = key;
  } catch {
    if (seq !== loadSeq) return;
    records.value = [];
    recomputeTotals();
    currentKey.value = key;
  }
}

function pushRecord(record: TokenUsageRecord | null | undefined): void {
  if (!record) return;
  records.value = [...records.value, record];
  totals.value = {
    promptTokens: totals.value.promptTokens + record.promptTokens,
    completionTokens: totals.value.completionTokens + record.completionTokens,
    totalTokens: totals.value.totalTokens + record.totalTokens,
    count: totals.value.count + 1,
  };
}

function reset(): void {
  loadSeq++;
  records.value = [];
  totals.value = {
    promptTokens: 0,
    completionTokens: 0,
    totalTokens: 0,
    count: 0,
  };
  currentKey.value = "";
}

export function useUsage(): UseUsageReturn {
  return {
    records,
    totals,
    currentKey,
    load,
    pushRecord,
    reset,
  };
}
