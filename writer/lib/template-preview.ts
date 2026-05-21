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

import { errorMessage } from "./errors.ts";
import { join } from "@std/path";
import type { Environment as VentoEnvironment } from "ventojs/core/environment";
import { validateTemplate } from "./template.ts";
import { createLogger } from "./logger.ts";
import type { AppDeps, ChatMessage, BuildPromptResult } from "../types.ts";
import {
  assertHasUserMessage,
  filterEmptyMessages,
  type MessageState,
  splitRenderedMessages,
} from "./vento-message-tag.ts";

const log = createLogger("template");

/**
 * Discriminated union for `renderSystemPromptForPreview` — `series`/`story`/
 * `storyDir`/`deps` are accepted only when `mode === "current"`; the TS
 * compiler will reject `default`/`inline` calls that try to inject IO bait.
 */
export type PreviewArgs =
  | {
    readonly mode: "default";
    readonly source: string;
    readonly templateKind: TemplateKind;
    readonly ventoEnv: VentoEnvironment;
    readonly fixture?: FixtureBag;
  }
  | {
    readonly mode: "inline";
    readonly source: string;
    readonly templateKind: TemplateKind;
    readonly ventoEnv: VentoEnvironment;
    readonly fixture: FixtureBag;
  }
  | {
    readonly mode: "current";
    readonly source: string;
    readonly templateKind: TemplateKind;
    readonly ventoEnv: VentoEnvironment;
    readonly series: string;
    readonly story: string;
    readonly deps: AppDeps;
  };

export type TemplateKind = "system" | "plugin-fragment" | "lore";

/** Fixture object — typed loosely (user-supplied JSON). */
export type FixtureBag = Record<string, unknown>;

export interface InjectedFieldReport {
  readonly injected: string[];
}

export type PreviewResult =
  | {
    readonly kind: "messages";
    readonly messages: ChatMessage[];
    readonly variables: InjectedFieldReport;
    readonly ventoError?: { message: string };
    readonly fixtureUsed: "default" | "inline" | "current";
  }
  | {
    readonly kind: "markdown";
    readonly content: string;
    readonly variables: InjectedFieldReport;
    readonly ventoError?: { message: string };
    readonly fixtureUsed: "default" | "inline" | "current";
  };

/**
 * Resolve a fixture to a Vento context. Auto-injects sane defaults for
 * missing core fields and reports which keys were defaulted in
 * `injected[]` so callers can surface this to the UI.
 */
export function fixtureToContext(
  fixture: FixtureBag,
): { context: Record<string, unknown>; injected: string[] } {
  const injected: string[] = [];
  const context: Record<string, unknown> = { ...fixture };

  const defaults: Record<string, unknown> = {
    series_name: "",
    story_name: "",
    user_input: "",
    isFirstRound: false,
    previous_context: [],
    plugin_fragments: [],
    chapter_number: 1,
  };

  for (const [k, v] of Object.entries(defaults)) {
    if (!(k in context)) {
      context[k] = v;
      injected.push(k);
    }
  }
  return { context, injected };
}

const REMEDIATION_HINT =
  "使用 `{{> include }}` 是不允許的；改用主模板具名變數、plugin promptFragments 或 getDynamicVariables() 注入內容";

/**
 * Pure-function preview renderer. Branches on `mode`:
 *   - `default` / `inline`: pure `runString(source, fixtureToContext(fixture))`;
 *     NEVER touches `pluginManager`, `storyDir`, `PLAYGROUND_DIR`.
 *   - `current`: delegates to `buildPromptFromStory` for `system` kind; for
 *     `plugin-fragment`/`lore` kinds it still uses pure Vento (no plugin
 *     fragment composition) but reads real lore/dynamic variables.
 *
 * SSTI is enforced in every branch via `validateTemplate()`. Mode is the
 * only signal that opens the door to IO.
 */
export async function renderSystemPromptForPreview(
  args: PreviewArgs,
): Promise<PreviewResult> {
  // SSTI guard — same whitelist as PUT-time, plugin-load-time, render-time.
  const sstiErrors = validateTemplate(args.source);
  if (sstiErrors.length > 0) {
    return {
      kind: args.templateKind === "system" ? "messages" : "markdown",
      ...(args.templateKind === "system" ? { messages: [] } : { content: "" }),
      variables: { injected: [] },
      ventoError: {
        message: `Template contains unsafe expressions — ${REMEDIATION_HINT}: ${sstiErrors.join("; ")}`,
      },
      fixtureUsed: args.mode,
    } as PreviewResult;
  }

  if (args.mode === "current") {
    return await renderCurrentMode(args);
  }

  // default or inline — both bundle: pure runString, no IO.
  const fixture: FixtureBag = args.fixture ?? {};
  const { context, injected } = fixtureToContext(fixture);

  if (args.templateKind === "system") {
    return await renderMessagesPure(args.ventoEnv, args.source, context, injected, args.mode);
  }
  return await renderMarkdownPure(args.ventoEnv, args.source, context, injected, args.mode);
}

async function renderMessagesPure(
  ventoEnv: VentoEnvironment,
  source: string,
  context: Record<string, unknown>,
  injected: string[],
  mode: "default" | "inline",
): Promise<PreviewResult> {
  const messageState: MessageState = {
    nonce: crypto.randomUUID(),
    messages: [],
  };
  try {
    const result = await ventoEnv.runString(source, {
      ...context,
      __messageState: messageState,
    });
    const rawMessages = splitRenderedMessages(
      result.content,
      messageState.nonce,
      messageState.messages,
    );
    const { kept: messages } = filterEmptyMessages(rawMessages);
    try {
      assertHasUserMessage(messages);
    } catch (err: unknown) {
      // Surface as ventoError but still return the partial messages array
      return {
        kind: "messages",
        messages,
        variables: { injected },
        ventoError: { message: errorMessage(err) },
        fixtureUsed: mode,
      };
    }
    return { kind: "messages", messages, variables: { injected }, fixtureUsed: mode };
  } catch (err: unknown) {
    log.warn("Preview render (messages) failed", {
      mode,
      error: errorMessage(err),
    });
    return {
      kind: "messages",
      messages: [],
      variables: { injected },
      ventoError: { message: errorMessage(err) },
      fixtureUsed: mode,
    };
  }
}

async function renderMarkdownPure(
  ventoEnv: VentoEnvironment,
  source: string,
  context: Record<string, unknown>,
  injected: string[],
  mode: "default" | "inline",
): Promise<PreviewResult> {
  try {
    const result = await ventoEnv.runString(source, { ...context });
    return { kind: "markdown", content: result.content, variables: { injected }, fixtureUsed: mode };
  } catch (err: unknown) {
    log.warn("Preview render (markdown) failed", {
      mode,
      error: errorMessage(err),
    });
    return {
      kind: "markdown",
      content: "",
      variables: { injected },
      ventoError: { message: errorMessage(err) },
      fixtureUsed: mode,
    };
  }
}

async function renderCurrentMode(
  args: PreviewArgs & { mode: "current" },
): Promise<PreviewResult> {
  const { series, story, deps, source, templateKind } = args;
  if (templateKind === "system") {
    // Delegate to the existing full pipeline.
    const storyDir = deps.safePath(series, story);
    if (!storyDir) {
      return {
        kind: "messages",
        messages: [],
        variables: { injected: [] },
        ventoError: { message: `Invalid path: series='${series}' story='${story}'` },
        fixtureUsed: "current",
      };
    }
    try {
      const result: BuildPromptResult = await deps.buildPromptFromStory(
        series,
        story,
        storyDir,
        "(preview)",
        source,
      );
      if (result.ventoError) {
        return {
          kind: "messages",
          messages: result.messages,
          variables: { injected: [] },
          ventoError: { message: result.ventoError.message ?? "Vento error" },
          fixtureUsed: "current",
        };
      }
      return {
        kind: "messages",
        messages: result.messages,
        variables: { injected: [] },
        fixtureUsed: "current",
      };
    } catch (err: unknown) {
      log.warn("Preview render (current/system) failed", {
        series,
        story,
        error: errorMessage(err),
      });
      return {
        kind: "messages",
        messages: [],
        variables: { injected: [] },
        ventoError: { message: errorMessage(err) },
        fixtureUsed: "current",
      };
    }
  }

  // Plugin-fragment / lore current mode: render against the real first-pass
  // lore + dynamic vars but as standalone markdown.
  try {
    const { resolveLoreVariables } = await import("./lore.ts");
    const lore = await resolveLoreVariables(deps.config.PLAYGROUND_DIR, series, story);
    const dynamic = await deps.pluginManager.getDynamicVariables({
      series,
      name: story,
      storyDir: deps.safePath(series, story) ?? "",
      userInput: "",
      chapterNumber: 1,
      previousContent: "",
      isFirstRound: false,
      chapterCount: 0,
    });
    const ctx: Record<string, unknown> = {
      ...dynamic,
      ...lore.variables,
      series_name: series,
      story_name: story,
      chapter_number: 1,
    };
    const result = await args.ventoEnv.runString(source, ctx);
    return { kind: "markdown", content: result.content, variables: { injected: [] }, fixtureUsed: "current" };
  } catch (err: unknown) {
    log.warn("Preview render (current/markdown) failed", {
      series,
      story,
      error: errorMessage(err),
    });
    return {
      kind: "markdown",
      content: "",
      variables: { injected: [] },
      ventoError: { message: errorMessage(err) },
      fixtureUsed: "current",
    };
  }
}

/**
 * Load the bundled default fixture from `writer/fixtures/template-preview.json`.
 * Cached after first read; safe under `--allow-read`.
 */
let cachedDefaultFixture: FixtureBag | null = null;
export async function loadDefaultFixture(rootDir?: string): Promise<FixtureBag> {
  if (cachedDefaultFixture) return cachedDefaultFixture;
  // Resolve relative to the source file so it works regardless of cwd.
  const url = new URL("../fixtures/template-preview.json", import.meta.url);
  let path = url.pathname;
  // If caller supplied a rootDir AND the source-relative path doesn't exist
  // (e.g. when bundled), fall back to the rootDir-relative location.
  try {
    const raw = await Deno.readTextFile(path);
    cachedDefaultFixture = JSON.parse(raw) as FixtureBag;
    return cachedDefaultFixture;
  } catch {
    if (!rootDir) throw new Error(`default fixture not found at ${path}`);
    path = join(rootDir, "writer", "fixtures", "template-preview.json");
    const raw = await Deno.readTextFile(path);
    cachedDefaultFixture = JSON.parse(raw) as FixtureBag;
    return cachedDefaultFixture;
  }
}

/** Test-only: reset the cached default fixture so reloads from disk. */
export function _resetDefaultFixtureCache(): void {
  cachedDefaultFixture = null;
}
