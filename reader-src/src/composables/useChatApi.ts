import { ref, watch } from "vue";
import type {
  ChatSendBeforeContext,
  RunPluginPromptOptions,
  RunPluginPromptResult,
  TokenUsageRecord,
  UseChatApiReturn,
  WsChatDoneMessage,
  WsClientMessage,
  WsPluginActionDoneMessage,
  WsServerMessage,
} from "@/types";
import { useWebSocket } from "@/composables/useWebSocket";
import { useNotification } from "@/composables/useNotification";
import { useUsage } from "@/composables/useUsage";
import { ApiError, apiFetch, apiFetchJson } from "@/lib/api";
import { frontendHooks } from "@/lib/plugin-hooks";

const isLoading = ref(false);
const errorMessage = ref("");
const streamingContent = ref("");

let currentRequestId: string | null = null;
let httpAbortController: AbortController | null = null;
let currentPluginActionId: string | null = null;

function dispatchNotification(event: string, data: Record<string, unknown>): void {
  const { notify } = useNotification();
  frontendHooks.dispatch("notification", { event, data, notify });
}

/**
 * Declarative spec for a single WebSocket request lifecycle.
 *
 * `TDone` is the concrete server `done` message type for the flow; `TResult`
 * is the value the returned promise resolves to. The terminal callbacks
 * (`onError`, `onAborted`, `onDisconnect`, `onTimeout`) may either return a
 * `TResult` (resolving the promise) or `throw` (rejecting it) — this is how
 * `runPluginPrompt` preserves its reject-on-error contract while the chat
 * flows resolve `false`.
 */
interface WsRequestSpec<TDone, TResult> {
  /** Correlation field name carried by this flow's server messages. */
  idField: "id" | "correlationId";
  /** Correlation id this request listens for. */
  id: string;
  deltaType: WsServerMessage["type"];
  doneType: WsServerMessage["type"];
  errorType: WsServerMessage["type"];
  abortedType: WsServerMessage["type"];
  /** Accumulate a streaming delta chunk. */
  onDelta: (msg: Record<string, unknown>) => void;
  /** Map the terminal done message to the resolved value. */
  onDone: (msg: TDone) => TResult;
  /** Handle the error message: return resolves, throw rejects. */
  onError: (msg: Record<string, unknown>) => TResult;
  /** Handle a server-confirmed abort: return resolves, throw rejects. */
  onAborted: () => TResult;
  /** Handle socket disconnect mid-flight: return resolves, throw rejects. */
  onDisconnect: () => TResult;
  /** Handle the request timeout: return resolves, throw rejects. */
  onTimeout: () => TResult;
  /** Set/clear the module-level current-id variable for this flow. */
  setCurrentId: (v: string | null) => void;
  /** Envelope to send once subscriptions are wired. */
  envelope: WsClientMessage;
  /** Request timeout in ms (default 300000). */
  timeoutMs?: number;
}

/**
 * Centralizes the WebSocket request lifecycle shared by `sendMessage`,
 * `resendMessage`, `continueLastChapter`, and `runPluginPrompt`'s WS path:
 * correlation-guarded delta/done/error/aborted subscriptions, a
 * `watch(isConnected)` disconnect guard, a single timeout, and a unified
 * `cleanup()` that tears everything down and clears the module-level
 * current-id variable. Every terminal path (done, error, aborted, disconnect,
 * timeout) runs `cleanup()` before its callback.
 */
function wsRequest<TDone, TResult>(
  spec: WsRequestSpec<TDone, TResult>,
): Promise<TResult> {
  const { isConnected, send, onMessage } = useWebSocket();
  // The spec carries dynamic message-type strings, so call the strongly-typed
  // onMessage through a loosened local view; each handler narrows via idField.
  const subscribe = onMessage as unknown as (
    type: WsServerMessage["type"],
    handler: (msg: Record<string, unknown>) => void,
  ) => () => void;
  const matches = (msg: Record<string, unknown>): boolean => msg[spec.idField] === spec.id;

  spec.setCurrentId(spec.id);

  return new Promise<TResult>((resolve, reject) => {
    // Idempotency guard: even though `cleanup()` tears down every subscription,
    // a second terminal source can already be queued (e.g. a Vue watcher
    // callback flushed in the same tick as a `chat:done`, or a timeout that
    // fired just before `done` arrived). `finish()` makes terminal handling
    // strictly once-only so a per-call callback (and its side effects) never
    // runs twice and the promise never double-settles.
    let settled = false;
    const finish = (run: () => void): void => {
      if (settled) return;
      settled = true;
      cleanup();
      run();
    };

    const unsubDelta = subscribe(spec.deltaType, (msg) => {
      if (!matches(msg) || settled) return;
      spec.onDelta(msg);
    });
    const unsubDone = subscribe(spec.doneType, (msg) => {
      if (!matches(msg)) return;
      finish(() => resolve(spec.onDone(msg as TDone)));
    });
    const unsubError = subscribe(spec.errorType, (msg) => {
      if (!matches(msg)) return;
      finish(() => {
        try {
          resolve(spec.onError(msg));
        } catch (err) {
          reject(err);
        }
      });
    });
    const unsubAborted = subscribe(spec.abortedType, (msg) => {
      if (!matches(msg)) return;
      finish(() => {
        try {
          resolve(spec.onAborted());
        } catch (err) {
          reject(err);
        }
      });
    });
    // Single disconnect guard for the in-flight request.
    const stopWatch = watch(isConnected, (connected) => {
      if (connected) return;
      finish(() => {
        try {
          resolve(spec.onDisconnect());
        } catch (err) {
          reject(err);
        }
      });
    });

    const timeout = setTimeout(() => {
      finish(() => {
        try {
          resolve(spec.onTimeout());
        } catch (err) {
          reject(err);
        }
      });
    }, spec.timeoutMs ?? 300_000);

    // Runs on EVERY terminal path (done, error, aborted, disconnect,
    // timeout) via `finish()`. Resetting streaming/loading state here — not in
    // the per-call callbacks — guarantees no terminal path can leave the UI
    // spinning.
    function cleanup(): void {
      clearTimeout(timeout);
      stopWatch();
      unsubDelta();
      unsubDone();
      unsubError();
      unsubAborted();
      spec.setCurrentId(null);
      streamingContent.value = "";
      isLoading.value = false;
    }

    // Guard against the socket having dropped between the caller's connected
    // check and this point: `watch` is not `immediate`, so an already-`false`
    // `isConnected` would otherwise never trigger the disconnect path, leaving
    // the request to hang until timeout.
    if (!isConnected.value) {
      finish(() => {
        try {
          resolve(spec.onDisconnect());
        } catch (err) {
          reject(err);
        }
      });
      return;
    }

    send(spec.envelope);
  });
}

function abortCurrentRequest(): void {
  const { isConnected, isAuthenticated, send } = useWebSocket();

  if (currentPluginActionId && isConnected.value && isAuthenticated.value) {
    // WebSocket plugin-action path: send abort envelope
    send({ type: "plugin-action:abort", correlationId: currentPluginActionId });
    return;
  }
  if (currentRequestId && isConnected.value && isAuthenticated.value) {
    // WebSocket chat path: send abort message
    send({ type: "chat:abort", id: currentRequestId });
  } else if (httpAbortController) {
    // HTTP path: abort the fetch request
    httpAbortController.abort();
    httpAbortController = null;
    streamingContent.value = "";
    isLoading.value = false;
  }
}

async function sendMessage(
  series: string,
  story: string,
  message: string,
): Promise<boolean> {
  const { isConnected, isAuthenticated } = useWebSocket();

  // Dispatch chat:send:before hook BEFORE assigning request ids or issuing
  // any network call. Pipeline semantics: handlers may return a string to
  // replace ctx.message.
  const beforeCtx: ChatSendBeforeContext = {
    message,
    series,
    story,
    mode: "send",
  };
  frontendHooks.dispatch("chat:send:before", beforeCtx);
  const outgoingMessage = beforeCtx.message;

  isLoading.value = true;
  errorMessage.value = "";
  streamingContent.value = "";

  if (isConnected.value && isAuthenticated.value) {
    // ── WebSocket path ──
    const id = crypto.randomUUID();
    return wsRequest<WsChatDoneMessage, boolean>({
      idField: "id",
      id,
      deltaType: "chat:delta",
      doneType: "chat:done",
      errorType: "chat:error",
      abortedType: "chat:aborted",
      setCurrentId: (v) => (currentRequestId = v),
      // Terminal-state reset (streamingContent/isLoading) is centralized in
      // wsRequest's cleanup(); callbacks only set flow-specific state.
      onDelta: (msg) => {
        streamingContent.value += msg.content as string;
      },
      onDone: (msg) => {
        useUsage().pushRecord(msg.usage);
        dispatchNotification("chat:done", { id });
        return true;
      },
      onError: () => {
        errorMessage.value = "發送失敗";
        dispatchNotification("chat:error", { id });
        return false;
      },
      onAborted: () => false,
      onDisconnect: () => {
        errorMessage.value = "連線中斷";
        return false;
      },
      onTimeout: () => {
        errorMessage.value = "請求逾時";
        return false;
      },
      envelope: { type: "chat:send", id, series, story, message: outgoingMessage },
    });
  }

  // ── HTTP fallback ──
  httpAbortController = new AbortController();

  try {
    const body: Record<string, string> = { message: outgoingMessage };

    const res = await apiFetch(
      `/api/stories/${encodeURIComponent(series)}/${encodeURIComponent(story)}/chat`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: httpAbortController.signal,
        throwOnError: false,
      },
    );

    if (!res.ok) {
      errorMessage.value = "發送失敗";
      dispatchNotification("chat:error", {});
      return false;
    }

    // Success path: try to sync usage from response or reconcile via GET.
    try {
      const body = (await res.json()) as { usage?: TokenUsageRecord | null };
      if (body && typeof body === "object" && body.usage) {
        useUsage().pushRecord(body.usage);
      } else {
        await useUsage().load(series, story);
      }
    } catch {
      await useUsage().load(series, story);
    }

    dispatchNotification("chat:done", {});
    return true;
  } catch (err: unknown) {
    if (err instanceof DOMException && err.name === "AbortError") {
      return false;
    }
    errorMessage.value = "發送失敗";
    dispatchNotification("chat:error", {});
    return false;
  } finally {
    httpAbortController = null;
    isLoading.value = false;
  }
}

async function resendMessage(
  series: string,
  story: string,
  message: string,
): Promise<boolean> {
  const { isConnected, isAuthenticated } = useWebSocket();

  // Dispatch chat:send:before hook BEFORE any network call. Pipeline
  // semantics: handlers may return a string to replace ctx.message.
  const beforeCtx: ChatSendBeforeContext = {
    message,
    series,
    story,
    mode: "resend",
  };
  frontendHooks.dispatch("chat:send:before", beforeCtx);
  const outgoingMessage = beforeCtx.message;

  isLoading.value = true;
  errorMessage.value = "";
  streamingContent.value = "";

  if (isConnected.value && isAuthenticated.value) {
    // ── WebSocket path ──
    const id = crypto.randomUUID();
    return wsRequest<WsChatDoneMessage, boolean>({
      idField: "id",
      id,
      deltaType: "chat:delta",
      doneType: "chat:done",
      errorType: "chat:error",
      abortedType: "chat:aborted",
      setCurrentId: (v) => (currentRequestId = v),
      // Terminal-state reset is centralized in wsRequest's cleanup().
      onDelta: (msg) => {
        streamingContent.value += msg.content as string;
      },
      onDone: (msg) => {
        useUsage().pushRecord(msg.usage);
        dispatchNotification("chat:done", { id });
        return true;
      },
      onError: () => {
        errorMessage.value = "重送失敗";
        dispatchNotification("chat:error", { id });
        return false;
      },
      onAborted: () => false,
      onDisconnect: () => {
        errorMessage.value = "連線中斷";
        return false;
      },
      onTimeout: () => {
        errorMessage.value = "請求逾時";
        return false;
      },
      envelope: { type: "chat:resend", id, series, story, message: outgoingMessage },
    });
  }

  // ── HTTP fallback ──
  httpAbortController = new AbortController();

  try {
    // Delete last chapter
    const delRes = await apiFetch(
      `/api/stories/${encodeURIComponent(series)}/${encodeURIComponent(story)}/chapters/last`,
      { method: "DELETE", signal: httpAbortController.signal, throwOnError: false },
    );

    if (!delRes.ok && delRes.status !== 404) {
      errorMessage.value = "重送失敗";
      dispatchNotification("chat:error", {});
      return false;
    }

    // Re-send the message
    const body: Record<string, string> = { message: outgoingMessage };

    const res = await apiFetch(
      `/api/stories/${encodeURIComponent(series)}/${encodeURIComponent(story)}/chat`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: httpAbortController.signal,
        throwOnError: false,
      },
    );

    if (!res.ok) {
      errorMessage.value = "重送失敗";
      dispatchNotification("chat:error", {});
      return false;
    }

    try {
      const body = (await res.json()) as { usage?: TokenUsageRecord | null };
      if (body && typeof body === "object" && body.usage) {
        useUsage().pushRecord(body.usage);
      } else {
        await useUsage().load(series, story);
      }
    } catch {
      await useUsage().load(series, story);
    }

    dispatchNotification("chat:done", {});
    return true;
  } catch (err: unknown) {
    if (err instanceof DOMException && err.name === "AbortError") {
      return false;
    }
    errorMessage.value = "重送失敗";
    dispatchNotification("chat:error", {});
    return false;
  } finally {
    httpAbortController = null;
    isLoading.value = false;
  }
}

async function continueLastChapter(
  series: string,
  story: string,
): Promise<boolean> {
  if (isLoading.value) {
    errorMessage.value = "續寫失敗";
    return false;
  }

  const { isConnected, isAuthenticated } = useWebSocket();

  isLoading.value = true;
  errorMessage.value = "";
  streamingContent.value = "";

  if (isConnected.value && isAuthenticated.value) {
    // ── WebSocket path ──
    const id = crypto.randomUUID();
    return wsRequest<WsChatDoneMessage, boolean>({
      idField: "id",
      id,
      deltaType: "chat:delta",
      doneType: "chat:done",
      errorType: "chat:error",
      abortedType: "chat:aborted",
      setCurrentId: (v) => (currentRequestId = v),
      // Terminal-state reset is centralized in wsRequest's cleanup().
      onDelta: (msg) => {
        streamingContent.value += msg.content as string;
      },
      onDone: (msg) => {
        useUsage().pushRecord(msg.usage);
        dispatchNotification("chat:done", { id });
        return true;
      },
      onError: () => {
        errorMessage.value = "續寫失敗";
        dispatchNotification("chat:error", { id });
        return false;
      },
      onAborted: () => false,
      onDisconnect: () => {
        errorMessage.value = "連線中斷";
        return false;
      },
      onTimeout: () => {
        errorMessage.value = "請求逾時";
        return false;
      },
      envelope: { type: "chat:continue", id, series, story },
    });
  }

  // ── HTTP fallback ──
  httpAbortController = new AbortController();

  try {
    const res = await apiFetch(
      `/api/stories/${encodeURIComponent(series)}/${encodeURIComponent(story)}/chat/continue`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: httpAbortController.signal,
        throwOnError: false,
      },
    );

    if (!res.ok) {
      errorMessage.value = "續寫失敗";
      dispatchNotification("chat:error", {});
      return false;
    }

    try {
      const body = (await res.json()) as { usage?: TokenUsageRecord | null };
      if (body && typeof body === "object" && body.usage) {
        useUsage().pushRecord(body.usage);
      } else {
        await useUsage().load(series, story);
      }
    } catch {
      await useUsage().load(series, story);
    }

    dispatchNotification("chat:done", {});
    return true;
  } catch (err: unknown) {
    if (err instanceof DOMException && err.name === "AbortError") {
      return false;
    }
    errorMessage.value = "續寫失敗";
    dispatchNotification("chat:error", {});
    return false;
  } finally {
    httpAbortController = null;
    isLoading.value = false;
  }
}

export function useChatApi(): UseChatApiReturn {
  return {
    isLoading,
    errorMessage,
    streamingContent,
    sendMessage,
    resendMessage,
    continueLastChapter,
    runPluginPrompt,
    abortCurrentRequest,
  };
}

async function runPluginPrompt(
  pluginName: string,
  promptFile: string,
  opts: RunPluginPromptOptions = {},
): Promise<RunPluginPromptResult> {
  if (isLoading.value) {
    throw new Error(
      "Another request is already in flight; cannot start runPluginPrompt.",
    );
  }

  const { isConnected, isAuthenticated } = useWebSocket();

  isLoading.value = true;
  errorMessage.value = "";
  streamingContent.value = "";

  const series = opts.series ?? "";
  const name = opts.name ?? "";

  if (isConnected.value && isAuthenticated.value) {
    // ── WebSocket path ──
    const correlationId = crypto.randomUUID();

    return await wsRequest<WsPluginActionDoneMessage, RunPluginPromptResult>({
      idField: "correlationId",
      id: correlationId,
      deltaType: "plugin-action:delta",
      doneType: "plugin-action:done",
      errorType: "plugin-action:error",
      abortedType: "plugin-action:aborted",
      setCurrentId: (v) => (currentPluginActionId = v),
      // Terminal-state reset is centralized in wsRequest's cleanup(); the
      // terminal callbacks here throw to preserve reject-on-error semantics.
      onDelta: (msg) => {
        streamingContent.value += msg.chunk as string;
      },
      onDone: (msg) => {
        if (msg.usage) useUsage().pushRecord(msg.usage);
        return {
          content: msg.content,
          usage: msg.usage,
          chapterUpdated: msg.chapterUpdated,
          chapterReplaced: msg.chapterReplaced ?? false,
          appendedTag: msg.appendedTag,
        };
      },
      onError: (msg) => {
        const problem = msg.problem as
          | { type?: string; title?: string; detail?: string }
          | undefined;
        const detail = problem?.detail ?? problem?.title ?? "外掛操作失敗";
        errorMessage.value = detail;
        // Attach the RFC 9457 `type` slug as `error.code` so consumers
        // (incl. cross-repo plugin handlers) can branch on the stable slug
        // instead of brittle human-readable detail text.
        const err = new Error(detail) as Error & { code?: string };
        if (problem?.type) err.code = problem.type;
        throw err;
      },
      onAborted: () => {
        throw new DOMException("Plugin action aborted.", "AbortError");
      },
      onDisconnect: () => {
        errorMessage.value = "連線中斷";
        throw new Error("連線中斷");
      },
      onTimeout: () => {
        errorMessage.value = "請求逾時";
        throw new Error("請求逾時");
      },
      envelope: {
        type: "plugin-action:run",
        correlationId,
        pluginName,
        series,
        name,
        promptFile,
        ...(opts.append !== undefined ? { append: opts.append } : {}),
        ...(opts.appendTag !== undefined ? { appendTag: opts.appendTag } : {}),
        ...(opts.replace !== undefined ? { replace: opts.replace } : {}),
        ...(opts.extraVariables !== undefined ? { extraVariables: opts.extraVariables } : {}),
      },
    });
  }

  // ── HTTP fallback ──
  httpAbortController = new AbortController();

  try {
    const body: Record<string, unknown> = {
      series,
      name,
      promptFile,
    };
    if (opts.append !== undefined) body.append = opts.append;
    if (opts.appendTag !== undefined) body.appendTag = opts.appendTag;
    if (opts.replace !== undefined) body.replace = opts.replace;
    if (opts.extraVariables !== undefined) {
      body.extraVariables = opts.extraVariables;
    }

    const res = await apiFetchJson<RunPluginPromptResult>(
      `/api/plugins/${encodeURIComponent(pluginName)}/run-prompt`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: httpAbortController.signal,
      },
    );

    if (res?.usage) useUsage().pushRecord(res.usage);
    return res;
  } catch (err: unknown) {
    if (err instanceof DOMException && err.name === "AbortError") {
      throw err;
    }
    if (err instanceof ApiError) {
      // Preserve the prior hand-parser's exact message: `detail ?? title ??
      // \`HTTP <status>\``. `ApiError.message` is detail-first but falls back to
      // statusText rather than `HTTP <status>`, so derive the message from the
      // structured fields to stay byte-identical.
      const b = (err.body && typeof err.body === "object")
        ? err.body as { detail?: unknown; title?: unknown }
        : undefined;
      const detail = typeof b?.detail === "string" ? b.detail : undefined;
      const message = detail ?? err.title ?? `HTTP ${err.status}`;
      errorMessage.value = message;
      // Attach the RFC 9457 `type` slug as `error.code` so consumers (incl.
      // cross-repo plugin handlers) can branch on the stable slug instead of
      // brittle human-readable detail text.
      const rethrow = new Error(message) as Error & { code?: string };
      if (err.type) rethrow.code = err.type;
      throw rethrow;
    }
    if (err instanceof Error) {
      if (!errorMessage.value) errorMessage.value = err.message;
      throw err;
    }
    errorMessage.value = "外掛操作失敗";
    throw new Error("外掛操作失敗");
  } finally {
    httpAbortController = null;
    isLoading.value = false;
  }
}
