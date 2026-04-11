// js/plugin-hooks.js — Frontend hook dispatcher for plugin system

const VALID_STAGES = new Set(['frontend-render']);

export class FrontendHookDispatcher {
  #handlers = new Map();

  register(stage, handler, priority = 100) {
    if (!VALID_STAGES.has(stage)) {
      console.warn(`Invalid frontend hook stage '${stage}' — skipping`);
      return;
    }
    if (!this.#handlers.has(stage)) this.#handlers.set(stage, []);
    const list = this.#handlers.get(stage);
    list.push({ handler, priority });
    list.sort((a, b) => a.priority - b.priority);
  }

  dispatch(stage, context) {
    const handlers = this.#handlers.get(stage) || [];
    for (const { handler } of handlers) {
      try {
        handler(context);
      } catch (err) {
        console.error(`Frontend hook error in '${stage}':`, err.message);
      }
    }
    return context;
  }
}
