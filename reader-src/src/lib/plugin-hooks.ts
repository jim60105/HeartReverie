import type {
  HookStage,
  HookHandler,
  FrontendRenderContext,
  NotificationContext,
  ChatSendBeforeContext,
  ChapterRenderAfterContext,
  StorySwitchContext,
  ChapterChangeContext,
} from "@/types";

type ContextMap = {
  "frontend-render": FrontendRenderContext;
  "notification": NotificationContext;
  "chat:send:before": ChatSendBeforeContext;
  "chapter:render:after": ChapterRenderAfterContext;
  "story:switch": StorySwitchContext;
  "chapter:change": ChapterChangeContext;
};

type AnyContext = ContextMap[HookStage];

interface HandlerEntry<T> {
  handler: HookHandler<T>;
  priority: number;
}

const VALID_STAGES: ReadonlySet<HookStage> = new Set<HookStage>([
  "frontend-render",
  "notification",
  "chat:send:before",
  "chapter:render:after",
  "story:switch",
  "chapter:change",
]);

export class FrontendHookDispatcher {
  #handlers = new Map<HookStage, HandlerEntry<AnyContext>[]>();

  register<S extends HookStage>(
    stage: S,
    handler: HookHandler<ContextMap[S]>,
    priority: number = 100,
  ): void {
    if (!VALID_STAGES.has(stage)) {
      console.warn(`Invalid frontend hook stage '${stage}' — skipping`);
      return;
    }
    if (!this.#handlers.has(stage)) this.#handlers.set(stage, []);
    const list = this.#handlers.get(stage)!;
    list.push({ handler: handler as HookHandler<AnyContext>, priority });
    list.sort((a, b) => a.priority - b.priority);
  }

  getHandlerCount(stage: HookStage): number {
    return this.#handlers.get(stage)?.length ?? 0;
  }

  dispatch<S extends HookStage>(stage: S, context: ContextMap[S]): ContextMap[S] {
    const handlers = this.#handlers.get(stage) ?? [];
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
