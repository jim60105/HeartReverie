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

import { useAuth } from "@/composables/useAuth";
import type {
  BranchResponse,
  ChapterEditResponse,
  ChapterRewindResponse,
  UseChapterActionsReturn,
} from "@/types";

/**
 * Throw an Error carrying the server-provided Problem Details `detail` when
 * available, otherwise the HTTP status text.
 */
async function throwFromResponse(res: Response): Promise<never> {
  let message = res.statusText;
  try {
    const body = await res.json();
    if (body && typeof body.detail === "string") message = body.detail;
    else if (body && typeof body.title === "string") message = body.title;
  } catch {
    // not JSON
  }
  throw new Error(message || `HTTP ${res.status}`);
}

export function useChapterActions(): UseChapterActionsReturn {
  const { getAuthHeaders } = useAuth();

  async function editChapter(
    series: string,
    story: string,
    num: number,
    content: string,
  ): Promise<ChapterEditResponse> {
    const res = await fetch(
      `/api/stories/${encodeURIComponent(series)}/${encodeURIComponent(story)}/chapters/${num}`,
      {
        method: "PUT",
        headers: {
          ...getAuthHeaders(),
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ content }),
      },
    );
    if (!res.ok) await throwFromResponse(res);
    return await res.json() as ChapterEditResponse;
  }

  async function rewindAfter(
    series: string,
    story: string,
    num: number,
  ): Promise<ChapterRewindResponse> {
    const res = await fetch(
      `/api/stories/${encodeURIComponent(series)}/${encodeURIComponent(story)}/chapters/after/${num}`,
      {
        method: "DELETE",
        headers: { ...getAuthHeaders() },
      },
    );
    if (!res.ok) await throwFromResponse(res);
    return await res.json() as ChapterRewindResponse;
  }

  async function branchFrom(
    series: string,
    story: string,
    fromChapter: number,
    newName?: string,
  ): Promise<BranchResponse> {
    const body: Record<string, unknown> = { fromChapter };
    if (newName) body.newName = newName;
    const res = await fetch(
      `/api/stories/${encodeURIComponent(series)}/${encodeURIComponent(story)}/branch`,
      {
        method: "POST",
        headers: {
          ...getAuthHeaders(),
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      },
    );
    if (!res.ok) await throwFromResponse(res);
    return await res.json() as BranchResponse;
  }

  return { editChapter, rewindAfter, branchFrom };
}
