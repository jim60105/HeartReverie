import type { HookStage, HookHandler, FrontendRenderContext } from "@/types";

type ContextMap = {
  "frontend-render": FrontendRenderContext;
};

interface HandlerEntry<T> {
  handler: HookHandler<T>;
  priority: number;
}

const VALID_STAGES: ReadonlySet<HookStage> = new Set(["frontend-render"]);

export class FrontendHookDispatcher {
  #handlers = new Map<HookStage, HandlerEntry<FrontendRenderContext>[]>();

  register(
    stage: HookStage,
    handler: HookHandler<ContextMap[typeof stage]>,
    priority: number = 100,
  ): void {
    if (!VALID_STAGES.has(stage)) {
      console.warn(`Invalid frontend hook stage '${stage}' — skipping`);
      return;
    }
    if (!this.#handlers.has(stage)) this.#handlers.set(stage, []);
    const list = this.#handlers.get(stage)!;
    list.push({ handler, priority });
    list.sort((a, b) => a.priority - b.priority);
  }

  dispatch<S extends HookStage>(stage: S, context: ContextMap[S]): ContextMap[S] {
    const handlers = this.#handlers.get(stage) ?? [];
    for (const { handler } of handlers) {
      try {
        handler(context);
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
