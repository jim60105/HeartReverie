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
import type { HtmlToken } from "@/types";

vi.mock("marked", () => ({
  marked: {
    parse: vi.fn((text: string) => `<p>${text}</p>`),
  },
}));

describe("useMarkdownRenderer vento-error coverage", () => {
  beforeEach(() => {
    vi.resetModules();
    stubSessionStorage();
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve([]),
          headers: new Headers(),
        })
      ),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("extracts vento-error placeholders and splits mixed tokens", async () => {
    const { useMarkdownRenderer } = await import("@/composables/useMarkdownRenderer");
    const { renderChapter } = useMarkdownRenderer();

    const tokens = renderChapter(
      [
        "before",
        "<vento-error><message>Broken render</message><source>system.md</source><line>3</line></vento-error>",
        "after",
      ].join("\n"),
      { isLastChapter: true },
    );

    const vento = tokens.find((t) => t.type === "vento-error");
    expect(vento).toBeDefined();

    const html = tokens.filter((t): t is HtmlToken => t.type === "html").map((t) => t.content).join(" ");
    expect(html).toContain("before");
    expect(html).toContain("after");
  });
});
