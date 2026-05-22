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

/**
 * Barrel re-export of the writer type domains. Consumers import from
 * `writer/types.ts` (or relatively as `../types.ts`) and remain agnostic of
 * the per-domain modules under `writer/types/`.
 *
 * Domain split:
 * - `types/llm.ts`     — LLM config, reasoning enum, stream chunk, usage records
 * - `types/story.ts`   — Story/template engines, chat message, render/prompt results, chapter & state-diff types, story-API payloads
 * - `types/hooks.ts`   — Hook stages, payloads, handler events
 * - `types/app.ts`     — App config, deps, middleware, RFC 9457 problem
 * - `types/plugin.ts`  — Plugin manifest, register/route context, dynamic vars
 * - `types/ws.ts`      — WebSocket protocol (client + server message unions)
 *
 * The only non-type runtime export is `REASONING_EFFORTS` from `llm.ts`.
 */

export { REASONING_EFFORTS } from "./types/llm.ts";

export type {
  LLMStreamChunk,
  LlmConfig,
  LlmDefaultsResponse,
  ReasoningEffort,
  StoryLlmConfigOverrides,
  TokenUsageRecord,
  UsageTotals,
} from "./types/llm.ts";

export type {
  BranchRequest,
  BranchResponse,
  BuildContinuePromptFn,
  BuildPromptFn,
  BuildPromptResult,
  ChapterEditRequest,
  ChapterEditResponse,
  ChapterEntry,
  ChapterRewindResponse,
  ChatMessage,
  ContinuePromptResult,
  RenderOptions,
  RenderResult,
  StateDiffEntry,
  StateDiffPayload,
  StoryEngine,
  StoryExportJson,
  TemplateEngine,
  VentoError,
} from "./types/story.ts";

export type {
  BackendParallelStage,
  HandlerEvent,
  HandlerEventSubscriber,
  HandlerEventSubscriptionOptions,
  HookHandler,
  HookStage,
  PostResponsePayload,
  PreLlmFetchPayload,
  ResponseStreamPayload,
} from "./types/hooks.ts";

export type {
  AppConfig,
  AppDeps,
  MiddlewareHandler,
  ProblemDetail,
  SafePathFn,
} from "./types/app.ts";

export type {
  ActionButtonDescriptor,
  ActionButtonVisibility,
  DynamicVariableContext,
  PluginHookDeclaration,
  PluginHooks,
  PluginManifest,
  PluginModule,
  PluginParameter,
  PluginRegisterContext,
  PluginRouteContext,
  PluginRunPromptRequest,
  PluginRunPromptResponse,
  PromptFragment,
  RegisterOptions,
} from "./types/plugin.ts";

export type {
  WsAuthErrorMessage,
  WsAuthMessage,
  WsAuthOkMessage,
  WsChaptersContentMessage,
  WsChaptersUpdatedMessage,
  WsChatAbortMessage,
  WsChatAbortedMessage,
  WsChatDeltaMessage,
  WsChatDoneMessage,
  WsChatErrorMessage,
  WsChatResendMessage,
  WsChatSendMessage,
  WsClientMessage,
  WsErrorMessage,
  WsPluginActionAbortMessage,
  WsPluginActionAbortedMessage,
  WsPluginActionDeltaMessage,
  WsPluginActionDoneMessage,
  WsPluginActionErrorMessage,
  WsPluginActionRunMessage,
  WsServerMessage,
  WsSubscribeMessage,
} from "./types/ws.ts";
