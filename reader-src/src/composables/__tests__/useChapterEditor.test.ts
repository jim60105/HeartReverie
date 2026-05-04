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

import { describe, it, expect, beforeEach } from "vitest";
import {
  useChapterEditor,
  __resetForTests,
} from "@/composables/useChapterEditor";

beforeEach(() => {
  __resetForTests();
});

describe("useChapterEditor", () => {
  it("beginEdit sets state correctly", () => {
    const { beginEdit, isEditing, editBuffer, editingChapterIndex } =
      useChapterEditor();

    beginEdit(2, "# Chapter content");

    expect(isEditing.value).toBe(true);
    expect(editBuffer.value).toBe("# Chapter content");
    expect(editingChapterIndex.value).toBe(2);
  });

  it("cancelEdit clears all state", () => {
    const { beginEdit, cancelEdit, isEditing, editBuffer, editingChapterIndex } =
      useChapterEditor();

    beginEdit(1, "Some content");
    cancelEdit();

    expect(isEditing.value).toBe(false);
    expect(editBuffer.value).toBe("");
    expect(editingChapterIndex.value).toBeNull();
  });

  it("forceCloseEditor is equivalent to cancelEdit", () => {
    const {
      beginEdit,
      forceCloseEditor,
      isEditing,
      editBuffer,
      editingChapterIndex,
    } = useChapterEditor();

    beginEdit(5, "Editor content");
    forceCloseEditor();

    expect(isEditing.value).toBe(false);
    expect(editBuffer.value).toBe("");
    expect(editingChapterIndex.value).toBeNull();
  });

  it("hasUnsavedBufferForChapter returns true for matching chapter with content", () => {
    const { beginEdit, hasUnsavedBufferForChapter } = useChapterEditor();

    beginEdit(3, "Unsaved work");

    expect(hasUnsavedBufferForChapter(3)).toBe(true);
    expect(hasUnsavedBufferForChapter(2)).toBe(false);
  });

  it("hasUnsavedBufferForChapter returns false when editBuffer is empty", () => {
    const { beginEdit, hasUnsavedBufferForChapter } = useChapterEditor();

    beginEdit(0, "");

    expect(hasUnsavedBufferForChapter(0)).toBe(false);
  });

  it("hasUnsavedBufferForChapter returns false when not editing", () => {
    const { hasUnsavedBufferForChapter } = useChapterEditor();

    expect(hasUnsavedBufferForChapter(0)).toBe(false);
  });

  it("shared state across multiple calls", () => {
    const first = useChapterEditor();
    const second = useChapterEditor();

    first.beginEdit(4, "Shared content");

    expect(second.isEditing.value).toBe(true);
    expect(second.editBuffer.value).toBe("Shared content");
    expect(second.editingChapterIndex.value).toBe(4);
  });

  it("__resetForTests clears everything", () => {
    const { beginEdit, isEditing, editBuffer, editingChapterIndex } =
      useChapterEditor();

    beginEdit(7, "Will be cleared");
    __resetForTests();

    expect(isEditing.value).toBe(false);
    expect(editBuffer.value).toBe("");
    expect(editingChapterIndex.value).toBeNull();
  });
});
