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

import { SourceError } from "ventojs/core/errors.js";
import type { Environment as VentoEnvironment } from "ventojs/core/environment.js";
import type { Token } from "ventojs/core/tokenizer.js";
import type { ChatMessage } from "../types.ts";

/** Allowed roles for `{{ message }}` blocks (OpenAI-compatible chat roles). */
export const ALLOWED_MESSAGE_ROLES: readonly ChatMessage["role"][] = [
  "system",
  "user",
  "assistant",
];

const ROLE_LITERAL_RE = /^"(system|user|assistant)"$/;
const ROLE_INVALID_LITERAL_RE = /^"[^"]*"$/;
const ROLE_IDENT_RE = /^[a-zA-Z_]\w*$/;

/**
 * Per-render side-channel state injected into the Vento data context as
 * `__messageState`. Hidden behind a single nested object so the SSTI
 * whitelist (which only accepts simple identifiers, not member access)
 * cannot leak the nonce or forge sentinels.
 */
export interface MessageState {
  nonce: string;
  messages: ChatMessage[];
}

/**
 * Vento plugin that registers the `{{ message <role> }} … {{ /message }}`
 * block tag pair. Inner content is rendered normally; the captured
 * `{role, content}` pair is pushed onto a per-render side-channel array on
 * the data context (`__messageState.messages`) and a unique sentinel is
 * emitted into the parent output stream so the lexical position can be
 * reconstructed by `splitRenderedMessages()`.
 *
 * @returns A Vento plugin function suitable for `env.use(...)`.
 */
export function messageTagPlugin(): (env: VentoEnvironment) => void {
  return (env: VentoEnvironment): void => {
    env.tags.push(messageTag);
  };
}

/**
 * Compile-time handler for the `{{ message }}` tag. Returns the JS string
 * Vento should emit for this tag, or `undefined` if the token is not a
 * `message` opener.
 */
function messageTag(
  env: VentoEnvironment,
  token: Token,
  output: string,
  tokens: Token[],
): string | undefined {
  const [, code, position] = token;
  if (!code.startsWith("message ") && code !== "message") {
    return undefined;
  }

  const roleExpr = code.slice("message".length).trim();
  if (!roleExpr) {
    throw new SourceError(
      "multi-message:invalid-role: missing role expression",
      position,
    );
  }

  // Compile-time nesting detection: scan ahead through `tokens` for a nested
  // `message` opener before the matching `/message` closer. Vento's tokens
  // array is shared and shifted by `compileTokens`, so we walk it without
  // mutating it here.
  const literalMatch = roleExpr.match(ROLE_LITERAL_RE);
  let roleSource: string;
  let runtimeValidate = false;

  if (literalMatch) {
    // Valid string-literal role.
    roleSource = JSON.stringify(literalMatch[1]);
  } else if (ROLE_INVALID_LITERAL_RE.test(roleExpr)) {
    // String literal that is NOT in the allow-list — reject at compile time.
    throw new SourceError(
      `multi-message:invalid-role: ${roleExpr} (allowed: "system", "user", "assistant")`,
      position,
    );
  } else if (ROLE_IDENT_RE.test(roleExpr)) {
    // Bare identifier — defer validation to runtime.
    roleSource = roleExpr;
    runtimeValidate = true;
  } else {
    throw new SourceError(
      `multi-message:invalid-role: unsupported role expression: ${roleExpr}`,
      position,
    );
  }

  // Scan for nested {{ message }} opener before matching {{ /message }}.
  for (const [type, innerCode, innerPos] of tokens) {
    if (type !== "tag") continue;
    if (innerCode === "/message") break;
    if (innerCode === "message" || innerCode.startsWith("message ")) {
      throw new SourceError(
        "multi-message:nested: a {{ message }} block cannot contain another {{ message }} block",
        innerPos,
      );
    }
  }

  const tmp = env.getTempVariable();
  const { dataVarname } = env.options;
  const compiled = env
    .compileTokens(tokens, tmp, "/message")
    .join("\n");

  const validateLine = runtimeValidate
    ? `if (__role !== "system" && __role !== "user" && __role !== "assistant") { throw new Error("multi-message:invalid-role: " + String(__role)); }`
    : "";

  return `{
    let ${tmp} = "";
    ${compiled}
    const __role = ${roleSource};
    ${validateLine}
    const __idx = ${dataVarname}.__messageState.messages.length;
    ${dataVarname}.__messageState.messages.push({ role: __role, content: ${tmp} });
    ${output} += "\\u0000MSG_" + ${dataVarname}.__messageState.nonce + "_" + __idx + "\\u0000";
  }`;
}

/**
 * Post-render assembler that converts a Vento-rendered string + side-channel
 * buffer into the final `ChatMessage[]`.
 *
 * - Sentinels matching the per-render `nonce` are replaced by their captured
 *   buffer entry.
 * - Non-empty intervening text segments become `{role: "system", content}`.
 * - Whitespace-only segments are dropped.
 * - Adjacent `system` messages (whether from text segments or author-emitted
 *   `{{ message "system" }}` blocks) are coalesced with `"\n"` joiners.
 * - Same-role non-system runs are NOT coalesced — author intent is preserved.
 *
 * Throws an error tagged `multi-message:assembly-corrupt` if any sentinel
 * captures an out-of-bounds, duplicate, or non-integer index.
 *
 * @param rendered Raw output of `runString`.
 * @param nonce    Per-render UUID set on `__messageState.nonce`.
 * @param buffer   Per-render side-channel `__messageState.messages`.
 * @returns Assembled `ChatMessage[]` ready for the upstream LLM.
 */
export function splitRenderedMessages(
  rendered: string,
  nonce: string,
  buffer: ChatMessage[],
): ChatMessage[] {
  // Escape regex-special characters in the nonce just in case (UUIDs don't
  // contain any, but be defensive).
  const escapedNonce = nonce.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`\\u0000MSG_${escapedNonce}_(\\d+)\\u0000`, "g");
  const consumed = new Set<number>();
  const assembled: ChatMessage[] = [];

  let lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = re.exec(rendered)) !== null) {
    const segment = rendered.slice(lastIndex, match.index);
    if (segment.length > 0 && segment.trim().length > 0) {
      pushSystem(assembled, segment);
    }
    const indexStr = match[1]!;
    const idx = Number(indexStr);
    if (!Number.isInteger(idx) || idx < 0 || idx >= buffer.length) {
      throw new Error(
        `multi-message:assembly-corrupt: sentinel index ${indexStr} out of bounds for buffer of size ${buffer.length}`,
      );
    }
    if (consumed.has(idx)) {
      throw new Error(
        `multi-message:assembly-corrupt: sentinel index ${indexStr} consumed more than once`,
      );
    }
    consumed.add(idx);
    const entry = buffer[idx]!;
    pushMessage(assembled, entry);
    lastIndex = match.index + match[0].length;
  }
  const tail = rendered.slice(lastIndex);
  if (tail.length > 0 && tail.trim().length > 0) {
    pushSystem(assembled, tail);
  }
  return assembled;
}

/**
 * Append a system-role text segment, coalescing with the previous message if
 * it is also a system message. Trims the segment before appending so leading
 * and trailing whitespace introduced by Vento control-flow indentation does
 * not leak into the assembled content.
 */
function pushSystem(out: ChatMessage[], content: string): void {
  const trimmed = content.trim();
  if (trimmed.length === 0) return;
  const last = out[out.length - 1];
  if (last && last.role === "system") {
    last.content = `${last.content}\n${trimmed}`;
    return;
  }
  out.push({ role: "system", content: trimmed });
}

/**
 * Append an author-emitted message, coalescing adjacent `system` runs but
 * preserving distinct runs of the same non-system role (per design D5).
 */
function pushMessage(out: ChatMessage[], entry: ChatMessage): void {
  if (entry.role === "system") {
    pushSystem(out, entry.content);
    return;
  }
  out.push({ role: entry.role, content: entry.content });
}

/**
 * Throw a tagged error if `messages` does not contain at least one `user`-role
 * element. The thrown `Error.message` begins with `multi-message:no-user-message`
 * so `buildVentoError()` can recognise and translate it to the public error
 * variant.
 */
export function assertHasUserMessage(messages: ChatMessage[]): void {
  if (!messages.some((m) => m.role === "user")) {
    throw new Error(
      "multi-message:no-user-message: rendered template emitted no user-role message",
    );
  }
}

/**
 * Drop messages with empty / whitespace-only content from the rendered
 * message list, returning the filtered array.
 *
 * Author templates often emit a `{{ message "X" }}` block that wraps a
 * conditional or `{{ for }}` body — when the iteration produces zero output
 * (e.g. an empty `previous_context`), the message renders to whitespace.
 * Keeping such messages would waste tokens and confuse upstream chat APIs
 * (some treat them as malformed), so we silently drop them. Authors who want
 * a strict check can call `assertNoEmptyMessages` directly.
 *
 * @returns {{ kept: ChatMessage[]; droppedCount: number }}
 */
export function filterEmptyMessages(
  messages: ChatMessage[],
): { kept: ChatMessage[]; droppedCount: number } {
  const kept: ChatMessage[] = [];
  let dropped = 0;
  for (const m of messages) {
    if (m.content.trim().length === 0) {
      dropped++;
      continue;
    }
    kept.push(m);
  }
  return { kept, droppedCount: dropped };
}

/**
 * Throw a tagged error if any message has whitespace-only or empty content.
 * Author-emitted `{{ message }}` blocks that render to nothing waste tokens
 * and confuse upstream chat APIs (some treat them as malformed). The thrown
 * `Error.message` begins with `multi-message:empty-message` so
 * `buildVentoError()` can recognise and translate it to the public error
 * variant.
 */
export function assertNoEmptyMessages(messages: ChatMessage[]): void {
  for (let i = 0; i < messages.length; i++) {
    const m = messages[i]!;
    if (m.content.trim().length === 0) {
      throw new Error(
        `multi-message:empty-message: message at index ${i} (role: ${m.role}) has empty or whitespace-only content`,
      );
    }
  }
}
