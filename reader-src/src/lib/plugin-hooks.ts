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
};

type AnyContext = ContextMap[HookStage];

interface HandlerEntry<T> {
  handler: HookHandler<T>;
  priority: number;
  originPluginName?: string;
}

const VALID_STAGES: ReadonlySet<HookStage> = new Set<HookStage>([
  "frontend-render",
  "notification",
  "chat:send:before",
  "chapter:render:after",
  "chapter:dom:ready",
  "chapter:dom:dispose",
  "story:switch",
  "chapter:change",
  "action-button:click",
]);

export class FrontendHookDispatcher {
  #handlers = new Map<HookStage, HandlerEntry<AnyContext>[]>();

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
    if (!this.#handlers.has(stage)) this.#handlers.set(stage, []);
    const list = this.#handlers.get(stage)!;
    list.push({
      handler: handler as HookHandler<AnyContext>,
      priority,
      originPluginName,
    });
    list.sort((a, b) => a.priority - b.priority);
  }

  getHandlerCount(stage: HookStage): number {
    return this.#handlers.get(stage)?.length ?? 0;
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
    for (const { handler } of handlers) {
      try {
        const result = (handler as (ctx: AnyContext) => unknown)(context);
        if (isPipeline && typeof result === "string") {
          // Pipeline semantics: string return replaces context.message
          (context as ChatSendBeforeContext).message = result;
        }
      } catch (err) {
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
