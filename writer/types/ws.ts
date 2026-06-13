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

import type { TokenUsageRecord } from "./llm.ts";
import type { StateDiffPayload } from "./story.ts";
import type { ProblemDetail } from "./app.ts";

// ── Client → Server ──

/** Client-to-server: authentication handshake. */
export interface WsAuthMessage {
  readonly type: "auth";
  readonly passphrase: string;
}

/** Client-to-server: send a chat message. */
export interface WsChatSendMessage {
  readonly type: "chat:send";
  readonly id: string;
  readonly series: string;
  readonly story: string;
  readonly message: string;
}

/** Client-to-server: resend (delete last chapter + re-send). */
export interface WsChatResendMessage {
  readonly type: "chat:resend";
  readonly id: string;
  readonly series: string;
  readonly story: string;
  readonly message: string;
}

/** Client-to-server: subscribe to chapter updates for a story. */
export interface WsSubscribeMessage {
  readonly type: "subscribe";
  readonly series: string;
  readonly story: string;
}

/** Client-to-server: abort an active chat generation. */
export interface WsChatAbortMessage {
  readonly type: "chat:abort";
  readonly id: string;
}

/** Client-to-server: invoke a plugin action prompt. */
export interface WsPluginActionRunMessage {
  readonly type: "plugin-action:run";
  readonly correlationId: string;
  readonly pluginName: string;
  readonly series: string;
  readonly name: string;
  readonly promptFile: string;
  readonly append?: boolean;
  readonly appendTag?: string;
  readonly extraVariables?: Record<string, string | number | boolean>;
}

/** Client-to-server: abort an in-flight plugin action run. */
export interface WsPluginActionAbortMessage {
  readonly type: "plugin-action:abort";
  readonly correlationId: string;
}

/** All client-to-server message types. */
export type WsClientMessage =
  | WsAuthMessage
  | WsChatSendMessage
  | WsChatResendMessage
  | WsChatAbortMessage
  | WsSubscribeMessage
  | WsPluginActionRunMessage
  | WsPluginActionAbortMessage;

// ── Server → Client ──

/** Server-to-client: authentication successful. */
export interface WsAuthOkMessage {
  readonly type: "auth:ok";
}

/** Server-to-client: authentication failed. */
export interface WsAuthErrorMessage {
  readonly type: "auth:error";
  readonly detail: string;
}

/** Server-to-client: streaming LLM delta chunk. */
export interface WsChatDeltaMessage {
  readonly type: "chat:delta";
  readonly id: string;
  readonly content: string;
}

/** Server-to-client: generation complete. */
export interface WsChatDoneMessage {
  readonly type: "chat:done";
  readonly id: string;
  readonly usage?: TokenUsageRecord | null;
}

/** Server-to-client: chat error. */
export interface WsChatErrorMessage {
  readonly type: "chat:error";
  readonly id: string;
  readonly detail: string;
  /**
   * Structured Vento template-error payload, carried additively for `vento`
   * errors only. Holds the same object the HTTP transport returns as its 422
   * `{ type: "vento-error", ... }` body so a frontend consumer can render the
   * same `VentoErrorCard`. Existing clients ignore this unknown field.
   */
  readonly ventoError?: Record<string, unknown>;
}

/** Server-to-client: chapter count changed. */
export interface WsChaptersUpdatedMessage {
  readonly type: "chapters:updated";
  readonly series: string;
  readonly story: string;
  readonly count: number;
}

/** Server-to-client: chapter content changed. */
export interface WsChaptersContentMessage {
  readonly type: "chapters:content";
  readonly series: string;
  readonly story: string;
  readonly chapter: number;
  readonly content: string;
  readonly stateDiff?: StateDiffPayload;
}

/** Server-to-client: generic protocol error. */
export interface WsErrorMessage {
  readonly type: "error";
  readonly detail: string;
}

/** Server-to-client: chat generation aborted. */
export interface WsChatAbortedMessage {
  readonly type: "chat:aborted";
  readonly id: string;
}

/** Server-to-client: streaming plugin-action delta chunk. */
export interface WsPluginActionDeltaMessage {
  readonly type: "plugin-action:delta";
  readonly correlationId: string;
  readonly chunk: string;
}

/** Server-to-client: plugin action completed successfully. */
export interface WsPluginActionDoneMessage {
  readonly type: "plugin-action:done";
  readonly correlationId: string;
  readonly content: string;
  readonly usage: TokenUsageRecord | null;
  readonly chapterUpdated: boolean;
  readonly chapterReplaced: boolean;
  readonly appendedTag: string | null;
}

/** Server-to-client: plugin action error. Carries an RFC 9457 Problem Details body. */
export interface WsPluginActionErrorMessage {
  readonly type: "plugin-action:error";
  readonly correlationId: string;
  readonly problem: ProblemDetail;
}

/** Server-to-client: plugin action aborted by client. */
export interface WsPluginActionAbortedMessage {
  readonly type: "plugin-action:aborted";
  readonly correlationId: string;
}

/** All server-to-client message types. */
export type WsServerMessage =
  | WsAuthOkMessage
  | WsAuthErrorMessage
  | WsChatDeltaMessage
  | WsChatDoneMessage
  | WsChatErrorMessage
  | WsChatAbortedMessage
  | WsChaptersUpdatedMessage
  | WsChaptersContentMessage
  | WsErrorMessage
  | WsPluginActionDeltaMessage
  | WsPluginActionDoneMessage
  | WsPluginActionErrorMessage
  | WsPluginActionAbortedMessage;
