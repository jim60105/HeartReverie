// Types shared across the HeartReverie frontend

// ── Story & Chapter Data ──

export interface ChapterData {
  number: number;
  content: string;
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
  currentContent: Ref<string>;
  mode: Ref<"fsa" | "backend">;
  folderName: Ref<string>;
  next: () => void;
  previous: () => void;
  loadFromFSA: (handle: FileSystemDirectoryHandle) => Promise<void>;
  loadFromBackend: (series: string, story: string, startChapter?: number) => Promise<void>;
  reloadToLast: () => Promise<void>;
  getBackendContext: () => {
    series: string | null;
    story: string | null;
    isBackendMode: boolean;
  };
}

export interface UsePluginsReturn {
  plugins: Ref<PluginDescriptor[]>;
  initialized: Ref<boolean>;
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
  templateContent: Ref<string>;
  lastSaved: Ref<string>;
  parameters: Ref<ParameterPill[]>;
  isDirty: ComputedRef<boolean>;
  isCustom: Ref<boolean>;
  isSaving: Ref<boolean>;
  save: () => Promise<void>;
  loadTemplate: () => Promise<void>;
  resetTemplate: () => Promise<void>;
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
  abortCurrentRequest: () => void;
}

export interface UseBackgroundReturn {
  backgroundUrl: Ref<string>;
  applyBackground: () => Promise<void>;
}

// ── Hook System Types ──

export type HookStage = "frontend-render";

export interface HookHandler<T = Record<string, unknown>> {
  (context: T): void;
}

export interface FrontendRenderContext {
  text: string;
  placeholderMap: Map<string, string>;
  options: RenderOptions;
}

export interface RenderOptions {
  isLastChapter?: boolean;
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

export interface PromptPreviewResult {
  prompt: string;
  fragments?: string[];
  variables?: Record<string, string>;
  errors?: VentoErrorCardProps[];
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

/** All client-to-server message types. */
export type WsClientMessage =
  | WsAuthMessage
  | WsChatSendMessage
  | WsChatResendMessage
  | WsChatAbortMessage
  | WsSubscribeMessage;

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
  | WsErrorMessage;

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


