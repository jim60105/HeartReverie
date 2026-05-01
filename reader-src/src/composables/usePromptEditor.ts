// Copyright (C) 2026 Jim Chen <Jim@ChenJ.im>, licensed under AGPL-3.0-or-later
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU AFFERO GENERAL PUBLIC LICENSE as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU AFFERO GENERAL PUBLIC LICENSE for more details.
//
// You should have received a copy of the GNU AFFERO GENERAL PUBLIC LICENSE
// along with this program.  If not, see <https://www.gnu.org/licenses/>.

/**
 * Singleton composable backing the Prompt Editor cards-mode UI.
 *
 * State semantics — see `openspec/changes/prompt-editor-message-ui/specs/prompt-editor/spec.md`
 * for the authoritative behaviour. Highlights:
 *
 * - `cards` / `originalCards` (internal snapshot) drive cards-mode dirty tracking
 *   (deep compare ignoring `id`).
 * - `rawSource` / `originalRawSource` drive raw-mode dirty tracking (string compare).
 * - The dirty baselines (`originalCards`, `originalRawSource`) are mutated ONLY on:
 *   (a) successful Load (set to deep clone of loaded state),
 *   (b) successful Save (refresh both to match current state),
 *   (c) Reset (revert via re-load).
 *   Mode toggles (`toggleRawFallback`) NEVER touch the baselines, so dirty edits
 *   in either view survive a round-trip through the other view without being
 *   silently promoted to "saved".
 * - `pendingCardsBeforeRaw` / `rawSnapshotForRoundTrip` preserve in-flight card
 *   edits across a cards → raw → cards round-trip when the raw text was not
 *   modified. They are internal scratch state and do NOT participate in
 *   `isDirty` (which always compares against the baselines).
 */

import { computed, ref, watch } from "vue";
import type {
  MessageCard,
  ParameterPill,
  PromptPreviewResult,
  UsePromptEditorReturn,
} from "@/types";
import { useAuth } from "@/composables/useAuth";
import { useStorySelector } from "@/composables/useStorySelector";
import {
  parseSystemTemplate,
  serializeMessageCards,
} from "@/lib/template-parser";

// ── Singleton module-level state ──

const cards = ref<MessageCard[]>([]);
/** Last-saved/loaded cards baseline (deep clone, no `id` comparison). */
const originalCards = ref<MessageCard[]>([]);

const rawSource = ref("");
const originalRawSource = ref("");

// Round-trip preservation: when toggling cards → raw we snapshot the current
// cards (deep clone) plus the raw text we just produced. On the way back to
// cards, if the raw text is identical to the snapshot, we restore the cards
// verbatim (including in-flight edits). If the raw text was modified, we
// re-parse instead. These are internal scratch state and never participate
// in dirty tracking.
const pendingCardsBeforeRaw = ref<MessageCard[] | null>(null);
const rawSnapshotForRoundTrip = ref("");

const parameters = ref<ParameterPill[]>([]);
const isCustom = ref(false);
const isSaving = ref(false);
const useRawFallback = ref(false);
const parseError = ref<string | null>(null);
const topLevelContentDropped = ref(false);

const mode = computed<"cards" | "raw">(() =>
  useRawFallback.value ? "raw" : "cards"
);

// ── Helpers ──

function cloneCards(input: MessageCard[]): MessageCard[] {
  return input.map((c) => ({ id: c.id, role: c.role, body: c.body }));
}

/** Deep-equal two card arrays ignoring the `id` field. */
function cardsEqual(a: MessageCard[], b: MessageCard[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const ai = a[i]!;
    const bi = b[i]!;
    if (ai.role !== bi.role || ai.body !== bi.body) return false;
  }
  return true;
}

const isDirty = computed<boolean>(() => {
  if (useRawFallback.value) {
    return rawSource.value !== originalRawSource.value;
  }
  return !cardsEqual(cards.value, originalCards.value);
});

/**
 * Per spec `Pre-save validity guard`: in cards mode, the save button is
 * disabled when the cards array is empty, when no card has `role === "user"`,
 * or when any card has a trimmed-empty body. The raw-fallback mode is exempt.
 * Returns the zh-TW tooltip when blocked, or `null` when the guard passes.
 */
const saveDisabledReason = computed<string | null>(() => {
  if (useRawFallback.value) return null;
  if (cards.value.length === 0) return "請至少新增一則訊息";
  if (!cards.value.some((c) => c.role === "user")) {
    return "請至少包含一則使用者訊息（傳送者：使用者）";
  }
  if (cards.value.some((c) => c.body.trim().length === 0)) {
    return "請填入所有訊息的內容";
  }
  return null;
});

// ── Actions ──

function applyParseResult(source: string): void {
  const result = parseSystemTemplate(source);
  if (result.parseError !== null || result.cards === null) {
    parseError.value = result.parseError;
    useRawFallback.value = true;
    rawSource.value = source;
    topLevelContentDropped.value = false;
    // Cards array left empty so save guard correctly blocks an empty save
    // if the user toggles back to cards without fixing the source.
    cards.value = [];
    originalCards.value = [];
    return;
  }
  cards.value = result.cards;
  originalCards.value = cloneCards(result.cards);
  rawSource.value = source;
  parseError.value = null;
  topLevelContentDropped.value = result.topLevelContentDropped;
  useRawFallback.value = false;
}

async function loadTemplate(): Promise<void> {
  const { getAuthHeaders } = useAuth();
  try {
    const res = await fetch("/api/template", {
      headers: { ...getAuthHeaders() },
    });
    if (!res.ok) return;
    const data: { content: string; source: "custom" | "default" } = await res
      .json();
    isCustom.value = data.source === "custom";
    originalRawSource.value = data.content;
    applyParseResult(data.content);
  } catch {
    // Ignore fetch errors
  }
}

async function save(): Promise<void> {
  if (isSaving.value) return;
  if (!isDirty.value) return;

  // Mode-specific validity guard. Cards mode blocks on the structural
  // requirements (empty / no-user / empty-body) per spec; raw mode is exempt.
  if (!useRawFallback.value && saveDisabledReason.value !== null) {
    throw new Error(saveDisabledReason.value);
  }

  let body: string;
  if (useRawFallback.value) {
    body = rawSource.value;
  } else {
    try {
      body = serializeMessageCards(cards.value);
    } catch (err) {
      // serializer throws RangeError on invalid role — surface inline.
      throw err instanceof Error ? err : new Error(String(err));
    }
  }

  const { getAuthHeaders } = useAuth();
  isSaving.value = true;
  try {
    const res = await fetch("/api/template", {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        ...getAuthHeaders(),
      },
      body: JSON.stringify({ content: body }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(
        (err as { detail?: string }).detail ?? "Failed to save template",
      );
    }
    // Refresh both snapshots: originalRawSource always, originalCards in
    // cards mode. The saved-event regression guard requires raw-mode saves
    // to also leave the editor clean.
    originalRawSource.value = body;
    if (!useRawFallback.value) {
      originalCards.value = cloneCards(cards.value);
    }
    isCustom.value = true;
  } finally {
    isSaving.value = false;
  }
}

async function resetTemplate(): Promise<void> {
  const { getAuthHeaders } = useAuth();
  try {
    await fetch("/api/template", {
      method: "DELETE",
      headers: { ...getAuthHeaders() },
    });
  } catch {
    // Ignore delete errors
  }
  await loadTemplate();
}

/**
 * Cards ↔ raw toggle.
 *
 * Mode toggles MUST NOT touch the dirty baselines (`originalCards`,
 * `originalRawSource`). Instead, in-flight card edits are preserved across
 * a cards → raw → cards round-trip via internal scratch state
 * (`pendingCardsBeforeRaw`, `rawSnapshotForRoundTrip`).
 *
 * - cards → raw: deep-clone current cards into `pendingCardsBeforeRaw`,
 *   serialise current cards into `rawSource`, and snapshot that serialisation
 *   into `rawSnapshotForRoundTrip` for round-trip comparison.
 * - raw → cards:
 *   - If the raw text is unchanged from the snapshot AND we have pending
 *     cards, restore them verbatim (in-flight edits survive).
 *   - Otherwise, re-parse the raw text. On success, replace `cards` with the
 *     parsed result. On failure, surface `parseError` and stay in raw mode
 *     (keeping the round-trip scratch so the user can retry after editing).
 *   - On any successful exit, clear the round-trip scratch.
 */
function toggleRawFallback(): void {
  if (!useRawFallback.value) {
    // cards → raw
    pendingCardsBeforeRaw.value = cloneCards(cards.value);
    rawSource.value = serializeMessageCards(cards.value);
    rawSnapshotForRoundTrip.value = rawSource.value;
    useRawFallback.value = true;
    return;
  }
  // raw → cards
  if (
    pendingCardsBeforeRaw.value !== null &&
    rawSource.value === rawSnapshotForRoundTrip.value
  ) {
    cards.value = pendingCardsBeforeRaw.value;
    pendingCardsBeforeRaw.value = null;
    rawSnapshotForRoundTrip.value = "";
    parseError.value = null;
    useRawFallback.value = false;
    return;
  }
  const result = parseSystemTemplate(rawSource.value);
  if (result.parseError !== null || result.cards === null) {
    parseError.value = result.parseError;
    return;
  }
  cards.value = result.cards;
  parseError.value = null;
  topLevelContentDropped.value = result.topLevelContentDropped;
  pendingCardsBeforeRaw.value = null;
  rawSnapshotForRoundTrip.value = "";
  useRawFallback.value = false;
}

function dismissParseError(): void {
  parseError.value = null;
}

function newId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `card-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function addCard(): void {
  cards.value.push({ id: newId(), role: "system", body: "" });
}

function deleteCard(id: string): void {
  const idx = cards.value.findIndex((c) => c.id === id);
  if (idx === -1) return;
  cards.value.splice(idx, 1);
}

function moveCardUp(id: string): void {
  const idx = cards.value.findIndex((c) => c.id === id);
  if (idx <= 0) return;
  const [card] = cards.value.splice(idx, 1);
  cards.value.splice(idx - 1, 0, card!);
}

function moveCardDown(id: string): void {
  const idx = cards.value.findIndex((c) => c.id === id);
  if (idx === -1 || idx >= cards.value.length - 1) return;
  const [card] = cards.value.splice(idx, 1);
  cards.value.splice(idx + 1, 0, card!);
}

/**
 * Returns the current source string the editor would PUT for the active mode.
 * Raw mode returns `rawSource` verbatim; cards mode runs the serialiser.
 */
function serializeCurrent(): string {
  if (useRawFallback.value) return rawSource.value;
  return serializeMessageCards(cards.value);
}

// ── Parameters fetch (variable list) ──

let parametersAbortController: AbortController | null = null;

async function loadParameters(series?: string, story?: string): Promise<void> {
  if (parametersAbortController) {
    parametersAbortController.abort();
  }
  parametersAbortController = new AbortController();
  const { signal } = parametersAbortController;

  const { getAuthHeaders } = useAuth();
  try {
    const url = new URL("/api/plugins/parameters", globalThis.location.origin);
    if (series) url.searchParams.set("series", series);
    if (story) url.searchParams.set("story", story);

    const res = await fetch(url.toString(), {
      headers: { ...getAuthHeaders() },
      signal,
    });
    if (!res.ok) return;
    parameters.value = await res.json();
  } catch {
    // Ignore (includes AbortError from cancelled requests)
  }
}

let initPromise: Promise<void> | null = null;
function ensureInit(): Promise<void> {
  if (!initPromise) {
    initPromise = Promise.all([loadTemplate(), loadParameters()]).then(
      () => {},
    );
  }
  return initPromise;
}

async function previewTemplate(
  series: string,
  story: string,
  message: string,
): Promise<PromptPreviewResult> {
  const { getAuthHeaders } = useAuth();
  const body: Record<string, string> = { message: message || "(preview)" };

  // Send current editor content for preview if it differs from saved.
  if (isDirty.value) {
    body["template"] = serializeCurrent();
  }

  const res = await fetch(
    `/api/stories/${encodeURIComponent(series)}/${
      encodeURIComponent(story)
    }/preview-prompt`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", ...getAuthHeaders() },
      body: JSON.stringify(body),
    },
  );

  if (!res.ok) {
    const err = await res.json();
    throw new Error(
      (err as { message?: string; detail?: string }).message ??
        (err as { detail?: string }).detail ??
        "Unknown error",
    );
  }

  return res.json() as Promise<PromptPreviewResult>;
}

let watcherInitialized = false;
function initStoryWatcher(): void {
  if (watcherInitialized) return;
  watcherInitialized = true;

  const { selectedSeries, selectedStory } = useStorySelector();

  watch(
    [selectedSeries, selectedStory],
    ([series, story]) => {
      loadParameters(series || undefined, story || undefined);
    },
    { immediate: true },
  );
}

export function usePromptEditor(): UsePromptEditorReturn {
  ensureInit();
  initStoryWatcher();

  return {
    mode,
    useRawFallback,
    cards,
    rawSource,
    originalRawSource,
    parameters,
    isCustom,
    isSaving,
    isDirty,
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
    serializeCurrent,
    dismissParseError,
    previewTemplate,
  };
}
