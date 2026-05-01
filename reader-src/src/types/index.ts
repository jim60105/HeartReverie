// Types shared across the HeartReverie frontend

// ── Story & Chapter Data ──

export interface ChapterData {
  number: number;
  content: string;
  stateDiff?: StateDiffPayload;
}

export interface StateDiffEntry {
  path: string;
  kind: "added" | "removed" | "modified" | "truncated";
  oldValue?: unknown;
  newValue?: unknown;
}

export interface StateDiffPayload {
  generatedAt: string;
  chapterNum: number;
  entries: StateDiffEntry[];
}

export interface StoryInfo {
  name: string;
}

export interface SeriesInfo {
  name: string;
}

export interface AuthHeaders {
  "X-Passphrase"?: string;
}

// ── Plugin System ──

export interface PluginDescriptor {
  name: string;
  hasFrontendModule: boolean;
  displayStripTags?: string[];
  frontendStyles?: string[];
  actionButtons?: ActionButtonDescriptor[];
}

// ── Plugin Action Buttons ──

/**
 * Declarative action-button entry contributed by a plugin via its
 * `plugin.json` manifest. Defaults are filled in by the backend before the
 * descriptor reaches the frontend, so consumers can rely on `priority` and
 * `visibleWhen` always being present in the API payload (see
 * `plugin-action-buttons` capability).
 */
export interface ActionButtonDescriptor {
  id: string;
  label: string;
  icon?: string;
  tooltip?: string;
  priority?: number;
  visibleWhen?: "last-chapter-backend" | "backend-only";
}

/**
 * Options for `runPluginPrompt` — passed to a plugin's curried helper from
 * inside an `action-button:click` handler. `pluginName` is bound by the
 * dispatcher and is NOT exposed on this options object.
 */
export interface RunPluginPromptOptions {
  series?: string;
  name?: string;
  append?: boolean;
  appendTag?: string;
  extraVariables?: Record<string, string | number | boolean>;
}

/** Final result envelope returned by `runPluginPrompt`. */
export interface RunPluginPromptResult {
  content: string;
  usage: TokenUsageRecord | null;
  chapterUpdated: boolean;
  appendedTag: string | null;
}

/**
 * Context passed to `action-button:click` handlers. Helpers are curried so
 * plugins cannot trigger another plugin's prompts (`runPluginPrompt` has the
 * owning plugin name pre-bound) and so handlers don't need to read route
 * state themselves.
 */
export interface ActionButtonClickContext {
  buttonId: string;
  pluginName: string;
  series: string;
  name: string;
  storyDir: string;
  lastChapterIndex: number | null;
  runPluginPrompt: (
    promptFile: string,
    opts?: RunPluginPromptOptions,
  ) => Promise<RunPluginPromptResult>;
  notify: (input: {
    level?: "info" | "warning" | "error";
    title?: string;
    body: string;
  }) => void;
  reload: () => Promise<void>;
}

export interface PluginManifest {
  name: string;
  description?: string;
  frontendModule?: string;
  backendModule?: string;
  promptFragments?: Record<string, string>;
  promptStripTags?: string[];
  displayStripTags?: string[];
}

// ── Component Props ──

export interface VentoErrorCardProps {
  message: string;
  source?: string;
  line?: number;
  suggestion?: string;
}

export interface ChapterContentProps {
  rawMarkdown: string;
  isLastChapter: boolean;
}

export interface ChatInputProps {
  disabled?: boolean;
}

export interface StorySelectorProps {
  visible?: boolean;
}

export interface PromptEditorProps {
  visible?: boolean;
}

export interface PromptPreviewProps {
  series: string;
  story: string;
  message: string;
  template?: string;
}

// ── Component Emits ──

export interface ChatInputEmits {
  (e: "send", message: string): void;
  (e: "resend", message: string): void;
  (e: "sent"): void;
}

export interface StorySelectorEmits {
  (e: "load", series: string, story: string): void;
}

export interface PassphraseGateEmits {
  (e: "unlocked"): void;
}

// ── Composable Return Types ──

import type { Ref, ComputedRef, ShallowRef, DeepReadonly } from "vue";

export interface UseAuthReturn {
  passphrase: DeepReadonly<Ref<string>>;
  isAuthenticated: Ref<boolean>;
  verify: (value?: string) => Promise<boolean>;
  getAuthHeaders: () => AuthHeaders;
}

export interface UseFileReaderReturn {
  isSupported: Ref<boolean>;
  directoryHandle: ShallowRef<FileSystemDirectoryHandle | null>;
  files: Ref<FileSystemFileHandle[]>;
  hasStoredHandle: Ref<boolean>;
  openDirectory: () => Promise<void>;
  restoreHandle: () => Promise<boolean>;
  readFile: (handle: FileSystemFileHandle) => Promise<string>;
  clearStoredHandle: () => Promise<void>;
}

export interface UseChapterNavReturn {
  currentIndex: Ref<number>;
  chapters: Ref<ChapterData[]>;
  totalChapters: ComputedRef<number>;
  isFirst: ComputedRef<boolean>;
  isLast: ComputedRef<boolean>;
  isLastChapter: ComputedRef<boolean>;
  currentContent: ShallowRef<string>;
  renderEpoch: Ref<number>;
  mode: Ref<"fsa" | "backend">;
  folderName: Ref<string>;
  next: () => void;
  previous: () => void;
  loadFromFSA: (handle: FileSystemDirectoryHandle) => Promise<void>;
  loadFromBackend: (series: string, story: string, startChapter?: number) => Promise<void>;
  reloadToLast: () => Promise<void>;
  refreshAfterEdit: (targetChapter: number) => Promise<void>;
  bumpRenderEpoch: () => void;
  getBackendContext: () => {
    series: string | null;
    story: string | null;
    isBackendMode: boolean;
  };
}

export interface UsePluginsReturn {
  plugins: Ref<PluginDescriptor[]>;
  pluginsReady: Ref<boolean>;
  pluginsSettled: Ref<boolean>;
  initPlugins: () => Promise<void>;
  applyDisplayStrip: (text: string) => string;
}

export interface UseStorySelectorReturn {
  seriesList: Ref<string[]>;
  storyList: Ref<string[]>;
  selectedSeries: Ref<string>;
  selectedStory: Ref<string>;
  fetchSeries: () => Promise<void>;
  fetchStories: (series: string) => Promise<void>;
  createStory: (series: string, name: string) => Promise<void>;
  navigateToStory: (series: string, story: string) => void;
}

export interface UsePromptEditorReturn {
  // Mode state
  mode: ComputedRef<"cards" | "raw">;
  useRawFallback: Ref<boolean>;

  // Cards mode state
  cards: Ref<MessageCard[]>;

  // Raw mode state
  rawSource: Ref<string>;
  originalRawSource: Ref<string>;

  // Variables / status
  parameters: Ref<ParameterPill[]>;
  isCustom: Ref<boolean>;
  isSaving: Ref<boolean>;
  isDirty: ComputedRef<boolean>;
  parseError: Ref<string | null>;
  topLevelContentDropped: Ref<boolean>;
  saveDisabledReason: ComputedRef<string | null>;

  // Actions
  save: () => Promise<void>;
  loadTemplate: () => Promise<void>;
  resetTemplate: () => Promise<void>;
  toggleRawFallback: () => void;
  addCard: () => void;
  deleteCard: (id: string) => void;
  moveCardUp: (id: string) => void;
  moveCardDown: (id: string) => void;
  serializeCurrent: () => string;
  dismissParseError: () => void;

  previewTemplate: (
    series: string,
    story: string,
    message: string,
  ) => Promise<PromptPreviewResult>;
}

export interface UseMarkdownRendererReturn {
  renderChapter: (
    rawMarkdown: string,
    options?: RenderOptions,
  ) => RenderToken[];
}

export interface UseChatApiReturn {
  isLoading: Ref<boolean>;
  errorMessage: Ref<string>;
  streamingContent: Ref<string>;
  sendMessage: (
    series: string,
    story: string,
    message: string,
  ) => Promise<boolean>;
  resendMessage: (
    series: string,
    story: string,
    message: string,
  ) => Promise<boolean>;
  runPluginPrompt: (
    pluginName: string,
    promptFile: string,
    opts?: RunPluginPromptOptions,
  ) => Promise<RunPluginPromptResult>;
  abortCurrentRequest: () => void;
}

export interface UseBackgroundReturn {
  backgroundUrl: Ref<string>;
  applyBackground: () => Promise<void>;
}

// ── Hook System Types ──

export type HookStage =
  | "frontend-render"
  | "notification"
  | "chat:send:before"
  | "chapter:render:after"
  | "chapter:dom:ready"
  | "chapter:dom:dispose"
  | "story:switch"
  | "chapter:change"
  | "action-button:click";

export interface HookHandler<T = Record<string, unknown>> {
  (context: T): void;
}

/**
 * Pipeline-style handler for `chat:send:before`. Handlers MAY return a
 * replacement string for `context.message`; any non-string return value is
 * ignored by the dispatcher.
 */
export interface ChatSendBeforeHandler {
  (context: ChatSendBeforeContext): string | void;
}

export interface FrontendRenderContext {
  text: string;
  placeholderMap: Map<string, string>;
  options: RenderOptions;
}

export interface ChatSendBeforeContext {
  message: string;
  series: string;
  story: string;
  mode: "send" | "resend";
}

export interface ChapterRenderAfterContext {
  tokens: RenderToken[];
  rawMarkdown: string;
  options: RenderOptions;
}

export interface ChapterDomReadyContext {
  container: HTMLElement;
  tokens: RenderToken[];
  rawMarkdown: string;
  chapterIndex: number;
}

export interface ChapterDomDisposeContext {
  container: HTMLElement;
  chapterIndex: number;
}

export interface StorySwitchContext {
  previousSeries: string | null;
  previousStory: string | null;
  series: string | null;
  story: string | null;
  mode: "fsa" | "backend";
}

export interface ChapterChangeContext {
  previousIndex: number | null;
  index: number;
  chapter: number;
  series: string | null;
  story: string | null;
  mode: "fsa" | "backend";
}

// ── Notification System ──

export type NotificationLevel = "info" | "success" | "warning" | "error";

export type NotificationPosition =
  | "top-left"
  | "top-right"
  | "bottom-left"
  | "bottom-right"
  | "top-center"
  | "bottom-center";

export type NotificationChannel = "in-app" | "system" | "auto";

export interface NotifyOptions {
  title: string;
  body?: string;
  level?: NotificationLevel;
  position?: NotificationPosition;
  channel?: NotificationChannel;
  duration?: number;
}

export interface ToastNotification {
  id: string;
  title: string;
  body?: string;
  level: NotificationLevel;
  position: NotificationPosition;
  createdAt: number;
}

export interface NotificationContext {
  event: string;
  data: Record<string, unknown>;
  notify: (options: NotifyOptions) => string;
}

export interface UseNotificationReturn {
  toasts: Ref<ToastNotification[]>;
  notify: (options: NotifyOptions) => string;
  dismiss: (id: string) => void;
  requestPermission: () => Promise<NotificationPermission>;
  permissionState: Ref<NotificationPermission | "unsupported">;
}

export interface RenderOptions {
  isLastChapter?: boolean;
  stateDiff?: StateDiffPayload;
}

// ── Render Token Types ──

export type RenderToken =
  | HtmlToken
  | VentoErrorToken;

export interface HtmlToken {
  type: "html";
  content: string;
}

export interface VentoErrorToken {
  type: "vento-error";
  data: VentoErrorCardProps;
}

// ── Prompt Preview ──

/**
 * Frontend mirror of the backend `ChatMessage` (writer/types.ts). Roles are
 * constrained to the OpenAI-compatible Chat Completions allow-list supported
 * by the `{{ message }}` Vento tag.
 */
export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

/**
 * Response shape of `POST /api/stories/:series/:name/preview-prompt`.
 *
 * After the `multi-message-prompt-template` change, the preview endpoint
 * returns the assembled `messages` array (one entry per upstream chat turn)
 * instead of a single rendered `prompt` string. The `fragments` and
 * `variables` fields are unchanged.
 */
export interface PromptPreviewResult {
  messages: ChatMessage[];
  fragments?: string[];
  variables?: Record<string, string>;
  errors?: VentoErrorCardProps[];
}

// ── Prompt Editor Message Cards ──

/**
 * Structured message-card representation used by the Prompt Editor cards
 * mode (see the `prompt-editor-message-cards` capability). The `id` field is
 * a frontend-only stable key for `<TransitionGroup>`/`v-for` and is never
 * persisted to disk by `serializeMessageCards()`.
 */
export interface MessageCard {
  id: string;
  role: "system" | "user" | "assistant";
  body: string;
}

export interface ParameterPill {
  name: string;
  source: string;
  type: string;
}

// ── Lore Codex ──

export interface LorePassageMetadata {
  filename: string;
  relativePath: string;
  directory: string;
  tags: string[];
  priority: number;
  enabled: boolean;
  scope: "global" | "series" | "story";
}

export interface LorePassageData {
  frontmatter: {
    tags: string[];
    priority: number;
    enabled: boolean;
  };
  content: string;
}

export interface UseLoreApiReturn {
  passages: import("vue").Ref<LorePassageMetadata[]>;
  allTags: import("vue").Ref<string[]>;
  loading: import("vue").Ref<boolean>;
  error: import("vue").Ref<string | null>;
  fetchPassages: (
    scope: string,
    series?: string,
    story?: string,
    tag?: string,
  ) => Promise<void>;
  fetchTags: () => Promise<void>;
  readPassage: (
    scope: string,
    path: string,
    series?: string,
    story?: string,
  ) => Promise<LorePassageData>;
  writePassage: (
    scope: string,
    path: string,
    frontmatter: LorePassageData["frontmatter"],
    content: string,
    series?: string,
    story?: string,
  ) => Promise<void>;
  deletePassage: (
    scope: string,
    path: string,
    series?: string,
    story?: string,
  ) => Promise<void>;
}

// ── Story LLM Config ──

/**
 * Reasoning-effort tuple — kept in sync with the backend tuple in
 * `writer/types.ts`. The two toolchains (Deno vs Vite) cannot share a literal
 * import directly; the parity test in `__tests__/reasoning-effort-parity.test.ts`
 * locks the two declarations against drift.
 */
export const REASONING_EFFORTS = [
  "none",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
] as const;

export type ReasoningEffort = typeof REASONING_EFFORTS[number];

export interface StoryLlmConfig {
  model?: string;
  temperature?: number;
  frequencyPenalty?: number;
  presencePenalty?: number;
  topK?: number;
  topP?: number;
  repetitionPenalty?: number;
  minP?: number;
  topA?: number;
  reasoningEnabled?: boolean;
  reasoningEffort?: ReasoningEffort;
  maxCompletionTokens?: number;
}

/**
 * Frontend mirror of `LlmDefaultsResponse` from `writer/types.ts`. Returned by
 * `GET /api/llm-defaults`. The route is contractually obligated to populate
 * every field — `validateLlmDefaultsBody` rejects partial responses and keeps
 * `defaults.value === null` so the page enters the "defaultsError" degraded
 * state instead of rendering blank disabled inputs.
 */
export interface LlmDefaultsResponse {
  model: string;
  temperature: number;
  frequencyPenalty: number;
  presencePenalty: number;
  topK: number;
  topP: number;
  repetitionPenalty: number;
  minP: number;
  topA: number;
  reasoningEnabled: boolean;
  reasoningEffort: ReasoningEffort;
  maxCompletionTokens: number;
}

export interface UseStoryLlmConfigReturn {
  overrides: Ref<StoryLlmConfig>;
  defaults: Ref<LlmDefaultsResponse | null>;
  loading: Ref<boolean>;
  saving: Ref<boolean>;
  defaultsLoading: Ref<boolean>;
  error: Ref<string | null>;
  defaultsError: Ref<string | null>;
  loadConfig: (series: string, name: string) => Promise<void>;
  loadLlmDefaults: () => Promise<void>;
  saveConfig: (
    series: string,
    name: string,
    overrides: StoryLlmConfig,
  ) => Promise<StoryLlmConfig>;
  reset: () => void;
}

// ── Token Usage Tracking ──

export interface TokenUsageRecord {
  chapter: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  model: string;
  timestamp: string;
}

export interface UsageTotals {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  count: number;
}

export interface UseUsageReturn {
  records: Ref<TokenUsageRecord[]>;
  totals: Ref<UsageTotals>;
  currentKey: Ref<string>;
  load: (series: string, story: string) => Promise<void>;
  pushRecord: (record: TokenUsageRecord | null | undefined) => void;
  reset: () => void;
}

// ── WebSocket Message Types ──

/** Client-to-server: authentication handshake. */
export interface WsAuthMessage {
  type: "auth";
  passphrase: string;
}

/** Client-to-server: send a chat message. */
export interface WsChatSendMessage {
  type: "chat:send";
  id: string;
  series: string;
  story: string;
  message: string;
}

/** Client-to-server: resend (delete last chapter + re-send). */
export interface WsChatResendMessage {
  type: "chat:resend";
  id: string;
  series: string;
  story: string;
  message: string;
}

/** Client-to-server: subscribe to chapter updates for a story. */
export interface WsSubscribeMessage {
  type: "subscribe";
  series: string;
  story: string;
}

/** Client-to-server: abort an active chat generation. */
export interface WsChatAbortMessage {
  type: "chat:abort";
  id: string;
}

/** Client-to-server: run a plugin-owned prompt. */
export interface WsPluginActionRunMessage {
  type: "plugin-action:run";
  correlationId: string;
  pluginName: string;
  series: string;
  name: string;
  promptFile: string;
  append?: boolean;
  appendTag?: string;
  extraVariables?: Record<string, string | number | boolean>;
}

/** Client-to-server: abort an in-flight plugin-action run. */
export interface WsPluginActionAbortMessage {
  type: "plugin-action:abort";
  correlationId: string;
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

/** Server-to-client: authentication successful. */
export interface WsAuthOkMessage {
  type: "auth:ok";
}

/** Server-to-client: authentication failed. */
export interface WsAuthErrorMessage {
  type: "auth:error";
  detail: string;
}

/** Server-to-client: streaming LLM delta chunk. */
export interface WsChatDeltaMessage {
  type: "chat:delta";
  id: string;
  content: string;
}

/** Server-to-client: generation complete. */
export interface WsChatDoneMessage {
  type: "chat:done";
  id: string;
  usage?: TokenUsageRecord | null;
}

/** Server-to-client: chat error. */
export interface WsChatErrorMessage {
  type: "chat:error";
  id: string;
  detail: string;
}

/** Server-to-client: chapter count changed. */
export interface WsChaptersUpdatedMessage {
  type: "chapters:updated";
  series: string;
  story: string;
  count: number;
}

/** Server-to-client: chapter content changed. */
export interface WsChaptersContentMessage {
  type: "chapters:content";
  series: string;
  story: string;
  chapter: number;
  content: string;
  stateDiff?: StateDiffPayload;
}

/** Server-to-client: generic protocol error. */
export interface WsErrorMessage {
  type: "error";
  detail: string;
}

/** Server-to-client: chat generation aborted. */
export interface WsChatAbortedMessage {
  type: "chat:aborted";
  id: string;
}

/** Server-to-client: plugin-action streaming delta chunk. */
export interface WsPluginActionDeltaMessage {
  type: "plugin-action:delta";
  correlationId: string;
  chunk: string;
}

/** Server-to-client: plugin-action run completed successfully. */
export interface WsPluginActionDoneMessage {
  type: "plugin-action:done";
  correlationId: string;
  content: string;
  usage: TokenUsageRecord | null;
  chapterUpdated: boolean;
  appendedTag: string | null;
}

/** Server-to-client: plugin-action run errored. */
export interface WsPluginActionErrorMessage {
  type: "plugin-action:error";
  correlationId: string;
  problem: { type?: string; title?: string; detail?: string; status?: number };
}

/** Server-to-client: plugin-action run aborted. */
export interface WsPluginActionAbortedMessage {
  type: "plugin-action:aborted";
  correlationId: string;
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

// ── WebSocket Composable Return ──

export interface UseWebSocketReturn {
  isConnected: import("vue").Ref<boolean>;
  isAuthenticated: import("vue").Ref<boolean>;
  send: (message: WsClientMessage) => void;
  onMessage: <T extends WsServerMessage["type"]>(
    type: T,
    handler: (msg: Extract<WsServerMessage, { type: T }>) => void,
  ) => () => void;
  connect: (url: string, passphrase: string) => void;
  disconnect: () => void;
}



// ── Chapter Actions ──

export interface ChapterEditRequest {
  content: string;
}

export interface ChapterEditResponse {
  number: number;
  content: string;
}

export interface ChapterRewindResponse {
  deleted: number[];
}

export interface BranchRequest {
  fromChapter: number;
  newName?: string;
}

export interface BranchResponse {
  series: string;
  name: string;
  copiedChapters: number[];
}

export interface UseChapterActionsReturn {
  editChapter: (
    series: string,
    story: string,
    number: number,
    content: string,
  ) => Promise<ChapterEditResponse>;
  rewindAfter: (
    series: string,
    story: string,
    number: number,
  ) => Promise<ChapterRewindResponse>;
  branchFrom: (
    series: string,
    story: string,
    fromChapter: number,
    newName?: string,
  ) => Promise<BranchResponse>;
}
