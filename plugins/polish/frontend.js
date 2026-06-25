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

export function register(hooks) {
  hooks.register(
    "action-button:click",
    async (ctx) => {
      if (ctx.pluginName !== "polish" || ctx.buttonId !== "polish") return;

      // Read the live chat-input text and treat a non-empty value as a one-off
      // directive that steers the literary rewrite. HeartReverie is single-user
      // and self-hosted, so the directive is trusted operator input: it is
      // passed VERBATIM (trim-only — no escaping, no length cap). An empty
      // (after-trim) textarea preserves the default v1 polish behaviour.
      const directive = (ctx.getChatInputText?.() ?? "").trim();

      const opts = { replace: true };
      if (directive) {
        opts.extraVariables = { polish_instruction: directive };
      }

      // The textarea is intentionally NOT cleared after the run.
      const result = await ctx.runPluginPrompt("polish-instruction.md", opts);

      if (result.chapterReplaced) {
        await ctx.reload();
      }
    },
    100,
    "polish",
  );
}
