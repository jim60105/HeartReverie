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

export function buildVentoError(err: Error, templatePath: string, knownVariables: { variables?: Record<string, string> }): VentoError {
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

  const varMatch = err.message.match(
    /(?:Variable|variable) ['"]?(\w+)['"]? (?:is )?not defined/i
  );
  if (varMatch) {
    const missing = varMatch[1]!;
    const allVarNames = Object.keys(knownVariables.variables || {}).concat([
      "scenario",
      "previous_context",
      "user_input",
      "status_data",
      "isFirstRound",
      "plugin_fragments",
    ]);
    const closest = findClosestMatch(missing, allVarNames);
    if (closest) error.suggestion = `Did you mean '${closest}'?`;
  }

  return error;
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
