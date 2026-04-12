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

export interface StatusBarProps {
  name: string;
  title: string;
  scene: string;
  thought: string;
  items: string;
  clothes: string;
  shoes: string;
  socks: string;
  accessories: string;
  closeUps: CloseUpEntry[];
}

export interface CloseUpEntry {
  part: string;
  description: string;
}

export interface OptionItem {
  number: number;
  text: string;
}

export interface OptionsPanelProps {
  items: OptionItem[];
}

export interface VariableDisplayProps {
  content: string;
  isComplete: boolean;
}

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

export interface OptionsPanelEmits {
  (e: "select", text: string): void;
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
  loadFromBackend: (series: string, story: string) => Promise<void>;
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
}

export interface UsePromptEditorReturn {
  templateContent: Ref<string>;
  originalTemplate: Ref<string>;
  parameters: Ref<ParameterPill[]>;
  savedTemplate: ComputedRef<string | undefined>;
  saveTemplate: () => void;
  loadTemplate: () => Promise<void>;
  resetTemplate: () => void;
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
  sendMessage: (
    series: string,
    story: string,
    message: string,
    template?: string,
  ) => Promise<boolean>;
  resendMessage: (
    series: string,
    story: string,
    message: string,
    template?: string,
  ) => Promise<boolean>;
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

// ── Tag Handler Registry ──

export interface TagHandler {
  extract: (
    text: string,
  ) => { text: string; blocks: ExtractedBlock[] };
}

export interface ExtractedBlock {
  placeholder: string;
  html: string;
}
