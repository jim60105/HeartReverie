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

import { beforeEach, describe, expect, it, vi } from "vitest";

const mockAuthHeaders = { "X-Passphrase": "pw" };
vi.mock("@/composables/useAuth", () => ({
  useAuth: () => ({
    passphrase: { value: "pw" },
    isAuthenticated: { value: true },
    verify: vi.fn(),
    getAuthHeaders: () => mockAuthHeaders,
  }),
}));

import { useChapterActions } from "@/composables/useChapterActions";

describe("useChapterActions", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("editChapter sends PUT with auth headers and returns payload", async () => {
    const payload = { number: 2, content: "new" };
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(payload), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const { editChapter } = useChapterActions();
    const res = await editChapter("s", "n", 2, "new");

    expect(res).toEqual(payload);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/stories/s/n/chapters/2");
    expect(init.method).toBe("PUT");
    expect(init.body).toBe(JSON.stringify({ content: "new" }));
    expect((init.headers as Record<string, string>)["X-Passphrase"]).toBe("pw");
  });

  it("editChapter throws on error with server detail", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ detail: "generation active" }), {
        status: 409,
        headers: { "Content-Type": "application/json" },
      }),
    ));

    const { editChapter } = useChapterActions();
    await expect(editChapter("s", "n", 1, "x")).rejects.toThrow("generation active");
  });

  it("rewindAfter sends DELETE and parses deleted array", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ deleted: [2, 3] }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const { rewindAfter } = useChapterActions();
    const res = await rewindAfter("s", "n", 1);
    expect(res).toEqual({ deleted: [2, 3] });
    expect((fetchMock.mock.calls[0] as [string, RequestInit])[0]).toBe(
      "/api/stories/s/n/chapters/after/1",
    );
    expect((fetchMock.mock.calls[0] as [string, RequestInit])[1]!.method).toBe("DELETE");
  });

  it("branchFrom sends POST with fromChapter and optional newName", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({ series: "s", name: "alt", copiedChapters: [1, 2] }),
        { status: 201 },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const { branchFrom } = useChapterActions();
    await branchFrom("s", "n", 2, "alt");
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual({ fromChapter: 2, newName: "alt" });
  });

  it("branchFrom omits newName when not provided", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({ series: "s", name: "auto", copiedChapters: [1] }),
        { status: 201 },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const { branchFrom } = useChapterActions();
    await branchFrom("s", "n", 1);
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toEqual({ fromChapter: 1 });
  });
});
