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

import { stubSessionStorage } from "@/__tests__/setup";

vi.mock("@/composables/useAuth", () => ({
  useAuth: () => ({
    getAuthHeaders: () => ({ "X-Passphrase": "test" }),
  }),
}));

describe("useUsage additional coverage", () => {
  beforeEach(() => {
    vi.resetModules();
    stubSessionStorage();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  async function getUsage() {
    const { useUsage } = await import("@/composables/useUsage");
    return useUsage();
  }

  it("recomputes totals when backend omits totals payload", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve({
          ok: true,
          status: 200,
          json: () =>
            Promise.resolve({
              records: [
                {
                  chapter: 1,
                  promptTokens: 2,
                  completionTokens: 3,
                  totalTokens: 5,
                  model: "m",
                  timestamp: "t",
                },
              ],
            }),
          headers: new Headers(),
        })
      ),
    );

    const usage = await getUsage();
    await usage.load("s", "t");
    expect(usage.totals.value.totalTokens).toBe(5);
    expect(usage.totals.value.count).toBe(1);
  });

  it("load catch path resets state and sets key", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new Error("offline"))));

    const usage = await getUsage();
    usage.pushRecord({
      chapter: 9,
      promptTokens: 1,
      completionTokens: 1,
      totalTokens: 2,
      model: "m",
      timestamp: "t",
    });

    await usage.load("series-x", "story-y");
    expect(usage.records.value).toEqual([]);
    expect(usage.currentKey.value).toBe("series-x/story-y");
    expect(usage.totals.value.count).toBe(0);
  });
});
