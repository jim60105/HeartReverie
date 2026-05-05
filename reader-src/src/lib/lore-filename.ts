// Copyright (C) 2026 Jim Chen <Jim@ChenJ.im>, licensed under AGPL-3.0-or-later
//
// Lore-filename derivation and validation helpers shared between the
// Quick-Add tool and the Import-Character-Card tool.

const FORBIDDEN = /[\\/:*?"<>|\u0000-\u001F]/g;
const VALID_PATTERN = /^[^\\/:*?"<>|\u0000-\u001F]+\.md$/;
const MAX_BYTES = 255;

// Mirror of `writer/lib/middleware.ts` isValidParam / isReservedDirectoryName.
const RESERVED_PLATFORM_DIRECTORY_NAMES: ReadonlySet<string> = new Set([
  "lost+found",
  "$RECYCLE.BIN",
  "System Volume Information",
  ".Spotlight-V100",
  ".Trashes",
  ".fseventsd",
]);

/**
 * Validate a series or story directory name against the backend's
 * `isValidParam` rule (`writer/lib/middleware.ts`):
 *   - non-empty after trim
 *   - no `..` substring, no NUL, no `/` or `\`
 *   - does NOT start with `_`
 *   - is not a reserved platform directory name (case-sensitive)
 */
export function isValidSeriesOrStoryName(value: string): boolean {
  const v = (value ?? "").trim();
  if (v.length === 0) return false;
  if (/\.\.|\x00|[/\\]/.test(v)) return false;
  if (v.startsWith("_")) return false;
  if (RESERVED_PLATFORM_DIRECTORY_NAMES.has(v)) return false;
  return true;
}

/**
 * Derive a CJK-preserving lore filename slug from a display name. NFC
 * normalises, replaces forbidden characters with `-`, collapses whitespace
 * runs to a single `-`, trims leading/trailing `-` and `.`, and appends
 * `.md`. Returns `fallback` (already including the `.md` suffix) when the
 * derived stem is empty.
 */
export function deriveLoreFilename(
  displayName: string,
  fallback: string,
): string {
  const norm = (displayName ?? "").normalize("NFC");
  let s = norm.replace(FORBIDDEN, "-");
  s = s.replace(/\s+/g, "-");
  s = s.replace(/^[-.]+|[-.]+$/g, "");
  if (s.length === 0) return fallback;
  return `${s}.md`;
}

/**
 * Append `.md` to a user-typed filename if missing. Empty input returns
 * empty string (caller may decide to fall back to a derived value).
 */
export function ensureMdExtension(filename: string): string {
  const trimmed = (filename ?? "").trim();
  if (trimmed.length === 0) return trimmed;
  return trimmed.endsWith(".md") ? trimmed : `${trimmed}.md`;
}

export interface FilenameValidation {
  valid: boolean;
  /** Reason key when invalid; absent when valid. */
  reason?: "format" | "traversal" | "reserved" | "too-long" | "empty";
}

/**
 * Validate a resolved filename. Rules (matching backend constraints):
 *   - matches `^[^\\/:*?"<>|\u0000-\u001F]+\.md$`
 *   - does NOT contain `..` as a substring
 *   - does NOT start with `.` or `_`
 *   - UTF-8 byte length ≤ 255
 */
export function validateLoreFilename(filename: string): FilenameValidation {
  if (!filename || filename.length === 0) return { valid: false, reason: "empty" };
  if (filename.includes("..")) return { valid: false, reason: "traversal" };
  if (filename.startsWith(".") || filename.startsWith("_")) {
    return { valid: false, reason: "reserved" };
  }
  if (!VALID_PATTERN.test(filename)) return { valid: false, reason: "format" };
  const byteLen = new TextEncoder().encode(filename).length;
  if (byteLen > MAX_BYTES) return { valid: false, reason: "too-long" };
  return { valid: true };
}

/**
 * Sanitise an array of tags against the backend's `isValidTag` rule:
 *   - non-empty after trim
 *   - ≤ 100 characters
 *   - contains none of `[`, `]`, `,`, `\n`, `\r`
 *
 * Returns `{ kept, dropped }` where `dropped` is grouped by reason so the
 * UI can surface targeted warnings.
 */
export interface TagSanitiseResult {
  kept: string[];
  droppedTooLong: string[];
  droppedSpecial: string[];
}

export function sanitiseTags(tags: string[]): TagSanitiseResult {
  const kept: string[] = [];
  const droppedTooLong: string[] = [];
  const droppedSpecial: string[] = [];
  for (const raw of tags) {
    if (typeof raw !== "string") continue;
    const t = raw.trim();
    if (t.length === 0) continue;
    if (t.length > 100) {
      droppedTooLong.push(t);
      continue;
    }
    if (/[\[\],\n\r]/.test(t)) {
      droppedSpecial.push(t);
      continue;
    }
    kept.push(t);
  }
  return { kept, droppedTooLong, droppedSpecial };
}
