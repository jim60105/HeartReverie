import type {
  HookStage,
  HookHandler,
  FrontendRenderContext,
  NotificationContext,
  ChatSendBeforeContext,
  ChapterRenderAfterContext,
  ChapterDomReadyContext,
  ChapterDomDisposeContext,
  StorySwitchContext,
  ChapterChangeContext,
  ActionButtonClickContext,
  HookInspectorReport,
} from "@/types";
import { useNotification } from "@/composables/useNotification";

type ContextMap = {
  "frontend-render": FrontendRenderContext;
  "notification": NotificationContext;
  "chat:send:before": ChatSendBeforeContext;
  "chapter:render:after": ChapterRenderAfterContext;
  "chapter:dom:ready": ChapterDomReadyContext;
  "chapter:dom:dispose": ChapterDomDisposeContext;
  "story:switch": StorySwitchContext;
  "chapter:change": ChapterChangeContext;
  "action-button:click": ActionButtonClickContext;
  "hook-inspector:report": HookInspectorReport;
};

type AnyContext = ContextMap[HookStage];

interface HandlerEntry<T> {
  handler: HookHandler<T>;
  priority: number;
  originPluginName?: string;
  errorCount: number;
}

/**
 * Frontend hook stages eligible for the strict declare-vs-register
 * cross-check at boot time. Kept in sync with `KNOWN_FRONTEND_STAGES` in
 * `writer/lib/plugin-manager.ts`.
 *
 * Note: `hook-inspector:report` is a typed event used by the inspector page
 * and consumed by external subscribers. It IS a known frontend stage and
 * may appear in manifest `hooks[]` declarations.
 */
const KNOWN_FRONTEND_STAGES: ReadonlySet<HookStage> = new Set<HookStage>([
  "frontend-render",
  "notification",
  "chat:send:before",
  "chapter:render:after",
  "chapter:dom:ready",
  "chapter:dom:dispose",
  "story:switch",
  "chapter:change",
  "action-button:click",
  "hook-inspector:report",
]);

const VALID_STAGES: ReadonlySet<HookStage> = KNOWN_FRONTEND_STAGES;

/** Per-stage handler info returned by `FrontendHookDispatcher.introspect()`. */
export interface HandlerIntrospection {
  readonly plugin: string | undefined;
  readonly priority: number;
  readonly errorCount: number;
}

export interface BootMismatchDetail {
  readonly plugin: string;
  readonly declaredOnly: readonly HookStage[];
  readonly registeredOnly: readonly HookStage[];
}

export class FrontendHookDispatcher {
  #handlers = new Map<HookStage, HandlerEntry<AnyContext>[]>();
  /** Per-plugin set of stages observed during register() calls. */
  #observedRegistrations = new Map<string, Set<HookStage>>();
  #bootMismatches: BootMismatchDetail[] = [];

  register<S extends HookStage>(
    stage: S,
    handler: HookHandler<ContextMap[S]>,
    priority: number = 100,
    originPluginName?: string,
  ): void {
    if (!VALID_STAGES.has(stage)) {
      console.warn(`Invalid frontend hook stage '${stage}' — skipping`);
      return;
    }
    // BREAKING: async-function handlers are rejected at register time for
    // every stage except `action-button:click` (whose dispatch path is
    // intentionally async).
    if (
      stage !== "action-button:click" &&
      typeof handler === "function" &&
      (handler as { constructor?: { name?: string } }).constructor?.name ===
        "AsyncFunction"
    ) {
      throw new Error(
        `Frontend hook handler for stage '${stage}'${originPluginName ? ` (plugin '${originPluginName}')` : ""} must be synchronous. Wrap async work: register(stage, (ctx) => { void doAsync(ctx).catch(log.error); })`,
      );
    }
    // Reject duplicate (plugin, stage) registrations ONLY for
    // `action-button:click`, where each button has exactly one owning
    // plugin. For other stages, plugins legitimately register multiple
    // handlers (different priorities / responsibilities).
    if (originPluginName !== undefined) {
      if (stage === "action-button:click") {
        const list = this.#handlers.get(stage) ?? [];
        const dup = list.some((e) => e.originPluginName === originPluginName);
        if (dup) {
          throw new Error(
            `Plugin '${originPluginName}' attempted to register a duplicate handler for stage '${stage}' — only one handler per (plugin, stage) is permitted for action-button:click`,
          );
        }
      }
      let observed = this.#observedRegistrations.get(originPluginName);
      if (!observed) {
        observed = new Set();
        this.#observedRegistrations.set(originPluginName, observed);
      }
      observed.add(stage);
    }

    if (!this.#handlers.has(stage)) this.#handlers.set(stage, []);
    const list = this.#handlers.get(stage)!;
    list.push({
      handler: handler as HookHandler<AnyContext>,
      priority,
      originPluginName,
      errorCount: 0,
    });
    list.sort((a, b) => a.priority - b.priority);
  }

  getHandlerCount(stage: HookStage): number {
    return this.#handlers.get(stage)?.length ?? 0;
  }

  /**
   * Return a deep-detached snapshot of every registered handler keyed by
   * stage, sorted by priority ascending. Callers MAY mutate the result;
   * mutations do NOT leak into dispatcher state.
   */
  introspect(): Record<HookStage, HandlerIntrospection[]> {
    const out = {} as Record<HookStage, HandlerIntrospection[]>;
    for (const [stage, list] of this.#handlers) {
      out[stage] = list.map((e) => ({
        plugin: e.originPluginName,
        priority: e.priority,
        errorCount: e.errorCount,
      }));
    }
    return out;
  }

  /**
   * Compute declare-vs-register mismatches scoped to frontend stages.
   * Plugins with no manifest `hooks` declaration are skipped (legacy mode).
   * Declared backend stages are ignored — those are validated by the
   * backend itself. MUST NOT throw.
   */
  finalizeBoot(
    manifestDeclarations: ReadonlyArray<{
      plugin: string;
      hooks: ReadonlyArray<{ stage: string }>;
    }>,
  ): void {
    this.#bootMismatches = [];
    for (const entry of manifestDeclarations) {
      const declaredFrontend = new Set<HookStage>(
        entry.hooks
          .map((h) => h.stage)
          .filter((s): s is HookStage =>
            KNOWN_FRONTEND_STAGES.has(s as HookStage)
          ),
      );
      const observed = this.#observedRegistrations.get(entry.plugin) ?? new Set<HookStage>();
      const declaredOnly: HookStage[] = [];
      const registeredOnly: HookStage[] = [];
      for (const s of declaredFrontend) {
        if (!observed.has(s)) declaredOnly.push(s);
      }
      for (const s of observed) {
        if (!declaredFrontend.has(s)) registeredOnly.push(s);
      }
      if (declaredOnly.length > 0 || registeredOnly.length > 0) {
        this.#bootMismatches.push({
          plugin: entry.plugin,
          declaredOnly,
          registeredOnly,
        });
      }
    }
    if (this.#bootMismatches.length > 0) {
      console.warn(
        "FrontendHookDispatcher: declare-vs-register mismatches",
        this.#bootMismatches,
      );
      try {
        const { notify } = useNotification();
        const names = this.#bootMismatches.map((m) => m.plugin).join(", ");
        notify({
          title: "外掛 hook 宣告不一致",
          body: `下列外掛 manifest hooks 與實際註冊不符：${names}`,
          level: "warning",
        });
      } catch {
        // Notification system unavailable — already logged above.
      }
    }
  }

  getBootMismatches(): readonly BootMismatchDetail[] {
    return this.#bootMismatches;
  }

  dispatch<S extends HookStage>(
    stage: S,
    context: ContextMap[S],
  ): S extends "action-button:click" ? Promise<ContextMap[S]>
    : ContextMap[S];
  dispatch(
    stage: HookStage,
    context: AnyContext,
  ): AnyContext | Promise<AnyContext> {
    const handlers = this.#handlers.get(stage) ?? [];

    if (stage === "action-button:click") {
      const clickCtx = context as ContextMap["action-button:click"];
      const matching = handlers.filter(
        (h) => h.originPluginName === clickCtx.pluginName,
      );
      return (async () => {
        for (const entry of matching) {
          try {
            await Promise.resolve(
              (entry.handler as (ctx: AnyContext) => unknown)(clickCtx),
            );
          } catch (err) {
            entry.errorCount++;
            const message = err instanceof Error ? err.message : String(err);
            console.error(
              `Frontend hook error in 'action-button:click':`,
              message,
            );
            try {
              const { notify } = useNotification();
              notify({
                title: "外掛操作失敗",
                body: `${clickCtx.pluginName}:${clickCtx.buttonId} — ${message}`,
                level: "error",
              });
            } catch {
              // Notification system unavailable — already logged above.
            }
          }
        }
        return clickCtx;
      })();
    }

    const isPipeline = stage === "chat:send:before";
    for (const entry of handlers) {
      try {
        const result = (entry.handler as (ctx: AnyContext) => unknown)(context);
        if (isPipeline && typeof result === "string") {
          // Pipeline semantics: string return replaces context.message
          (context as ChatSendBeforeContext).message = result;
        } else if (
          result !== null &&
          typeof result === "object" &&
          typeof (result as { then?: unknown }).then === "function"
        ) {
          // Handler is not declared async but returned a Promise — guard
          // against unhandled rejections and count them. The dispatcher
          // does NOT await; this is a best-effort safety net for
          // non-action-button stages.
          (result as Promise<unknown>).catch((err) => {
            entry.errorCount++;
            console.error(
              `Frontend hook error in '${stage}' (deferred rejection):`,
              err instanceof Error ? err.message : err,
            );
          });
        }
      } catch (err) {
        entry.errorCount++;
        console.error(
          `Frontend hook error in '${stage}':`,
          err instanceof Error ? err.message : err,
        );
      }
    }
    return context;
  }
}

export const frontendHooks = new FrontendHookDispatcher();
