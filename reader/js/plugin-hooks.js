// js/plugin-hooks.js — Frontend hook dispatcher for plugin system

export class FrontendHookDispatcher {
  #handlers = new Map();

  register(stage, handler, priority = 100) {
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
