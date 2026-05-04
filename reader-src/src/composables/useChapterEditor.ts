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
import type { Ref } from "vue";

export interface UseChapterEditorReturn {
  isEditing: Ref<boolean>;
  editBuffer: Ref<string>;
  editingChapterIndex: Ref<number | null>;
  hasUnsavedBufferForChapter: (chapterIndex: number) => boolean;
  beginEdit: (chapterIndex: number, rawMarkdown: string) => void;
  cancelEdit: () => void;
  forceCloseEditor: () => void;
}

// Module-level shared refs — all callers share the same state
const isEditing = ref(false);
const editBuffer = ref("");
const editingChapterIndex = ref<number | null>(null);

function hasUnsavedBufferForChapter(chapterIndex: number): boolean {
  return (
    isEditing.value === true &&
    editingChapterIndex.value === chapterIndex &&
    editBuffer.value !== ""
  );
}

function beginEdit(chapterIndex: number, rawMarkdown: string): void {
  isEditing.value = true;
  editBuffer.value = rawMarkdown;
  editingChapterIndex.value = chapterIndex;
}

function cancelEdit(): void {
  isEditing.value = false;
  editBuffer.value = "";
  editingChapterIndex.value = null;
}

function forceCloseEditor(): void {
  cancelEdit();
}

export function useChapterEditor(): UseChapterEditorReturn {
  return {
    isEditing,
    editBuffer,
    editingChapterIndex,
    hasUnsavedBufferForChapter,
    beginEdit,
    cancelEdit,
    forceCloseEditor,
  };
}

/** Testing utility — reset singleton state for test isolation. */
export function __resetForTests(): void {
  isEditing.value = false;
  editBuffer.value = "";
  editingChapterIndex.value = null;
}
