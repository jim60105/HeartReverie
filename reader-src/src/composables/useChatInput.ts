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

import { ref, watch } from "vue";
import { useChapterNav } from "@/composables/useChapterNav";

/**
 * Shared chat-input state.
 *
 * The chat textarea's text is hoisted out of `ChatInput.vue` into this
 * **module-scoped singleton** so that other reader code (notably the plugin
 * action bar via `getChatInputText()`) can read the *live* value — including
 * text typed but not yet sent — without going through the stale sessionStorage
 * value (which is only written on send/resend).
 *
 * Single-instance constraint: there is exactly one production `ChatInput`
 * mount (`MainLayout.vue`). Because `inputText` is module-scoped, a second
 * concurrent `ChatInput` would intentionally share the same value. This is a
 * deliberate design decision; future overlay UIs must not assume isolation.
 *
 * Story-awareness: a bare singleton would survive story switches and leak one
 * story's unsent text into another. To prevent this the composable tracks the
 * active `<series>:<story>` key and re-seeds `inputText` from the story-scoped
 * sessionStorage value whenever the active story changes — both via a watch on
 * the backend story context and defensively via `syncToStory(...)` callers.
 */

const STORAGE_KEY_PREFIX = "heartreverie:chat-input";

// Module-scoped singleton state.
const inputText = ref("");
/** Last `<series>:<story>` key `inputText` was seeded for (null before first sync). */
let activeKey: string | null = null;
/** Guards one-time installation of the active-story watch. */
let watchInstalled = false;

/** Build the story-scoped sessionStorage key for a given series/story. */
function getStorageKey(series: string | null, story: string | null): string {
  return `${STORAGE_KEY_PREFIX}:${series ?? ""}:${story ?? ""}`;
}

/** Compose the in-memory active-story key from series/story. */
function composeKey(series: string | null, story: string | null): string {
  return `${series ?? ""}:${story ?? ""}`;
}

/** Read the persisted draft for a story (empty string when absent or on error). */
function loadPersistedText(series: string | null, story: string | null): string {
  try {
    return sessionStorage.getItem(getStorageKey(series, story)) ?? "";
  } catch {
    // Silently ignore storage errors (e.g., private browsing restrictions).
    return "";
  }
}

/** Resolve the currently-active series/story from the backend nav context. */
function currentSeriesStory(): { series: string | null; story: string | null } {
  const ctx = useChapterNav().getBackendContext();
  return { series: ctx.series, story: ctx.story };
}

/**
 * Persist the given text under the *currently-active* story key. Called by
 * `ChatInput.vue` before a send/resend, preserving the prior behaviour.
 */
function persistText(text: string): void {
  const { series, story } = currentSeriesStory();
  try {
    sessionStorage.setItem(getStorageKey(series, story), text);
  } catch {
    // Silently ignore storage errors (e.g., private browsing restrictions).
  }
}

/**
 * Re-seed `inputText` from the story-scoped sessionStorage value when the
 * active story key differs from the last-seeded key. No-op when the key is
 * unchanged, so freshly-typed text for the active story is never clobbered.
 */
function syncToStory(series: string | null, story: string | null): void {
  const key = composeKey(series, story);
  if (key === activeKey) return;
  activeKey = key;
  inputText.value = loadPersistedText(series, story);
}

/**
 * Append `text` to the current input, separating with a newline when the
 * input is already non-empty (the chat textarea's pre-existing rule).
 */
function appendText(text: string): void {
  const current = inputText.value;
  inputText.value = current ? `${current}\n${text}` : text;
}

/**
 * Install (once) a watch on the active backend story context so the singleton
 * re-seeds at the composable layer — not only when `ChatInput` remounts.
 */
function ensureStoryWatch(): void {
  if (watchInstalled) return;
  watchInstalled = true;
  const { getBackendContext } = useChapterNav();
  watch(
    () => {
      const ctx = getBackendContext();
      return composeKey(ctx.series, ctx.story);
    },
    () => {
      const { series, story } = currentSeriesStory();
      syncToStory(series, story);
    },
    { immediate: true },
  );
}

export function useChatInput() {
  ensureStoryWatch();
  return {
    inputText,
    getStorageKey,
    loadPersistedText,
    persistText,
    appendText,
    syncToStory,
  };
}

/**
 * Reset the module-scoped singleton to a pristine state. Test-only helper so
 * each test starts with a clean `inputText`/`activeKey`, mirroring the
 * `__reset*ForTests` pattern used by other composables. Not for production use.
 */
export function __resetChatInputForTests(): void {
  inputText.value = "";
  activeKey = null;
}
