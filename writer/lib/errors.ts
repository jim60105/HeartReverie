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

import { basename } from "@std/path";
import type { ProblemDetail, VentoError } from "../types.ts";

export function problemJson(title: string, status: number, detail: string, extra: Record<string, unknown> = {}): ProblemDetail {
  return { type: "about:blank", title, status, detail, ...extra };
}

/**
 * RFC 9457 Problem Details factory variants for the `plugin-action:*` route
 * family. Each helper returns a fully-formed `ProblemDetail` object ready to
 * pass to `c.json(...)` together with its matching HTTP status. The `type`
 * slug follows the `plugin-action:<reason>` convention so frontends can
 * branch on the failure category without parsing English titles.
 */
export const pluginActionProblems = {
  invalidPromptPath(detail = "Invalid prompt path"): ProblemDetail {
    return { type: "plugin-action:invalid-prompt-path", title: "Bad Request", status: 400, detail };
  },
  nonMdPrompt(detail = "Prompt file must have a .md extension"): ProblemDetail {
    return { type: "plugin-action:non-md-prompt", title: "Bad Request", status: 400, detail };
  },
  promptFileNotFound(detail = "Prompt file not found"): ProblemDetail {
    return { type: "plugin-action:prompt-file-not-found", title: "Bad Request", status: 400, detail };
  },
  unknownPlugin(detail = "Plugin is not loaded"): ProblemDetail {
    return { type: "plugin-action:unknown-plugin", title: "Not Found", status: 404, detail };
  },
  invalidPluginName(detail = "Plugin name is syntactically invalid"): ProblemDetail {
    return { type: "plugin-action:invalid-plugin-name", title: "Bad Request", status: 400, detail };
  },
  invalidAppendTag(detail = "appendTag is missing or invalid"): ProblemDetail {
    return { type: "plugin-action:invalid-append-tag", title: "Bad Request", status: 400, detail };
  },
  concurrentGeneration(detail = "Another generation is already in flight for this story"): ProblemDetail {
    return { type: "plugin-action:concurrent-generation", title: "Conflict", status: 409, detail };
  },
  invalidExtraVariables(detail = "extraVariables values must be string, number, or boolean"): ProblemDetail {
    return { type: "plugin-action:invalid-extra-variables", title: "Bad Request", status: 400, detail };
  },
  extraVariablesCollision(detail = "extraVariables key collides with a reserved system variable"): ProblemDetail {
    return { type: "plugin-action:extra-variables-collision", title: "Bad Request", status: 400, detail };
  },
  invalidReplaceCombo(detail = "append and replace are mutually exclusive; replace cannot be combined with appendTag"): ProblemDetail {
    return { type: "plugin-action:invalid-replace-combo", title: "Bad Request", status: 400, detail };
  },
  noChapter(detail = "Story directory contains no chapter file"): ProblemDetail {
    return { type: "plugin-action:no-chapter", title: "Bad Request", status: 400, detail };
  },
} as const;

export function buildVentoError(err: Error, templatePath: string, knownVariables: { variables?: Record<string, string> }, extraKnownVars?: string[]): VentoError {
  const error: VentoError = {
    type: "vento-error",
    stage: "prompt-assembly",
    message: err.message,
    source: basename(templatePath),
    line: null,
    suggestion: null,
  };

  const lineMatch = err.message.match(/line (\d+)/i);
  if (lineMatch) error.line = parseInt(lineMatch[1]!, 10);

  // Multi-message tag error variants — recognised by tagged prefixes thrown
  // from `vento-message-tag.ts` (compile-time `SourceError`s carry the same
  // message prefixes via their inherited `.message`).
  const multiMessageTag = matchMultiMessageTag(err.message);
  if (multiMessageTag) {
    error.type = multiMessageTag;
    error.title = multiMessageTitle(multiMessageTag);
    error.suggestion = multiMessageSuggestion(multiMessageTag, err.message);
    return error;
  }

  const varMatch = err.message.match(
    /(?:Variable|variable) ['"]?(\w+)['"]? (?:is )?not defined/i
  );
  if (varMatch) {
    const missing = varMatch[1]!;
    const allVarNames = Object.keys(knownVariables.variables || {}).concat(
      [
        "previous_context",
        "user_input",
        "isFirstRound",
        "series_name",
        "story_name",
        "plugin_fragments",
      ],
      extraKnownVars || [],
    );
    const closest = findClosestMatch(missing, allVarNames);
    if (closest) error.suggestion = `Did you mean '${closest}'?`;
  }

  return error;
}

const MULTI_MESSAGE_TAGS = [
  "multi-message:invalid-role",
  "multi-message:nested",
  "multi-message:no-user-message",
  "multi-message:empty-message",
  "multi-message:assembly-corrupt",
] as const;

type MultiMessageTag = typeof MULTI_MESSAGE_TAGS[number];

function matchMultiMessageTag(message: string): MultiMessageTag | null {
  for (const tag of MULTI_MESSAGE_TAGS) {
    if (message.includes(tag)) return tag;
  }
  return null;
}

function multiMessageTitle(tag: MultiMessageTag): string {
  switch (tag) {
    case "multi-message:invalid-role":
      return "Invalid Message Role";
    case "multi-message:nested":
      return "Nested Message Block";
    case "multi-message:no-user-message":
      return "Missing User Message";
    case "multi-message:empty-message":
      return "Empty Message Content";
    case "multi-message:assembly-corrupt":
      return "Message Assembly Error";
  }
}

function multiMessageSuggestion(
  tag: MultiMessageTag,
  message: string,
): string {
  switch (tag) {
    case "multi-message:invalid-role": {
      // Try to surface the offending value in the suggestion.
      const after = message.split("multi-message:invalid-role")[1] ?? "";
      const trimmed = after.replace(/^[\s:]+/, "").trim();
      const detail = trimmed.length > 0 ? ` (got: ${trimmed.split("\n")[0]})` : "";
      return `Use one of "system", "user", or "assistant" as the role of {{ message }} blocks${detail}.`;
    }
    case "multi-message:nested":
      return "Split the inner {{ message }} block out to the top level — nested message blocks are not supported.";
    case "multi-message:no-user-message":
      return "Add a {{ message \"user\" }}{{ user_input }}{{ /message }} block (typically at the end of the template) so the request ends on a user turn.";
    case "multi-message:empty-message":
      return "Every {{ message }} block must contain non-whitespace content. Either add content or remove the block.";
    case "multi-message:assembly-corrupt":
      return "Internal error assembling the rendered messages. Please report this with the template that triggered it.";
  }
}

export function findClosestMatch(target: string, candidates: string[]): string | null {
  let best: string | null = null;
  let bestDist: number = Infinity;
  for (const c of candidates) {
    const d = levenshtein(target, c);
    if (d < bestDist && d <= 3) {
      best = c;
      bestDist = d;
    }
  }
  return best;
}

export function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0) as number[]);
  for (let i = 0; i <= m; i++) dp[i]![0] = i;
  for (let j = 0; j <= n; j++) dp[0]![j] = j;
  for (let i = 1; i <= m; i++)
    for (let j = 1; j <= n; j++)
      dp[i]![j] =
        a[i - 1] === b[j - 1]
          ? dp[i - 1]![j - 1]!
          : 1 + Math.min(dp[i - 1]![j]!, dp[i]![j - 1]!, dp[i - 1]![j - 1]!);
  return dp[m]![n]!;
}

/**
 * Safely serialize an error for structured logging.
 * Extracts name, message, and stack from Error instances.
 */
export function serializeError(error: unknown): Record<string, unknown> {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      ...(error.stack ? { stack: error.stack } : {}),
    };
  }
  return { message: String(error) };
}
