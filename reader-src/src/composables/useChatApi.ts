import { ref, watch } from "vue";
import type {
  UseChatApiReturn,
  ChatSendBeforeContext,
  TokenUsageRecord,
  RunPluginPromptOptions,
  RunPluginPromptResult,
} from "@/types";
import { useAuth } from "@/composables/useAuth";
import { useWebSocket } from "@/composables/useWebSocket";
import { useNotification } from "@/composables/useNotification";
import { useUsage } from "@/composables/useUsage";
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
  const { isConnected, isAuthenticated, send, onMessage } = useWebSocket();

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
    currentRequestId = id;
    return new Promise<boolean>((resolve) => {
      const unsubDelta = onMessage('chat:delta', (msg) => {
        if (msg.id !== id) return;
        streamingContent.value += msg.content;
      });
      const unsubDone = onMessage('chat:done', (msg) => {
        if (msg.id !== id) return;
        cleanup();
        streamingContent.value = '';
        isLoading.value = false;
        useUsage().pushRecord(msg.usage);
        dispatchNotification('chat:done', { id });
        resolve(true);
      });
      const unsubError = onMessage('chat:error', (msg) => {
        if (msg.id !== id) return;
        cleanup();
        streamingContent.value = '';
        errorMessage.value = '發送失敗';
        isLoading.value = false;
        dispatchNotification('chat:error', { id });
        resolve(false);
      });
      const unsubAborted = onMessage('chat:aborted', (msg) => {
        if (msg.id !== id) return;
        cleanup();
        streamingContent.value = '';
        isLoading.value = false;
        resolve(false);
      });
      // Detect socket disconnection while waiting for response
      const stopWatchClose = watch(isConnected, (connected) => {
        if (!connected) {
          cleanup();
          streamingContent.value = '';
          errorMessage.value = '連線中斷';
          isLoading.value = false;
          resolve(false);
        }
      });

      // Timeout to prevent infinite hang (5 minutes)
      const timeout = setTimeout(() => {
        cleanup();
        streamingContent.value = '';
        errorMessage.value = '請求逾時';
        isLoading.value = false;
        resolve(false);
      }, 300_000);

      function cleanup(): void {
        clearTimeout(timeout);
        stopWatchClose();
        unsubDelta();
        unsubDone();
        unsubError();
        unsubAborted();
        currentRequestId = null;
      }

      send({ type: 'chat:send', id, series, story, message: outgoingMessage });
    });
  }

  // ── HTTP fallback ──
  const { getAuthHeaders } = useAuth();
  httpAbortController = new AbortController();

  try {
    const body: Record<string, string> = { message: outgoingMessage };

    const res = await fetch(
      `/api/stories/${encodeURIComponent(series)}/${encodeURIComponent(story)}/chat`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", ...getAuthHeaders() },
        body: JSON.stringify(body),
        signal: httpAbortController.signal,
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
  const { isConnected, isAuthenticated, send, onMessage } = useWebSocket();

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
    currentRequestId = id;
    return new Promise<boolean>((resolve) => {
      const unsubDelta = onMessage('chat:delta', (msg) => {
        if (msg.id !== id) return;
        streamingContent.value += msg.content;
      });
      const unsubDone = onMessage('chat:done', (msg) => {
        if (msg.id !== id) return;
        cleanup();
        streamingContent.value = '';
        isLoading.value = false;
        useUsage().pushRecord(msg.usage);
        dispatchNotification('chat:done', { id });
        resolve(true);
      });
      const unsubError = onMessage('chat:error', (msg) => {
        if (msg.id !== id) return;
        cleanup();
        streamingContent.value = '';
        errorMessage.value = '重送失敗';
        isLoading.value = false;
        dispatchNotification('chat:error', { id });
        resolve(false);
      });
      const unsubAborted = onMessage('chat:aborted', (msg) => {
        if (msg.id !== id) return;
        cleanup();
        streamingContent.value = '';
        isLoading.value = false;
        resolve(false);
      });
      const stopWatchClose = watch(isConnected, (connected) => {
        if (!connected) {
          cleanup();
          streamingContent.value = '';
          errorMessage.value = '連線中斷';
          isLoading.value = false;
          resolve(false);
        }
      });

      const timeout = setTimeout(() => {
        cleanup();
        streamingContent.value = '';
        errorMessage.value = '請求逾時';
        isLoading.value = false;
        resolve(false);
      }, 300_000);

      function cleanup(): void {
        clearTimeout(timeout);
        stopWatchClose();
        unsubDelta();
        unsubDone();
        unsubError();
        unsubAborted();
        currentRequestId = null;
      }

      send({ type: 'chat:resend', id, series, story, message: outgoingMessage });
    });
  }

  // ── HTTP fallback ──
  const { getAuthHeaders } = useAuth();
  httpAbortController = new AbortController();

  try {
    // Delete last chapter
    const delRes = await fetch(
      `/api/stories/${encodeURIComponent(series)}/${encodeURIComponent(story)}/chapters/last`,
      { method: "DELETE", headers: { ...getAuthHeaders() }, signal: httpAbortController.signal },
    );

    if (!delRes.ok && delRes.status !== 404) {
      errorMessage.value = "重送失敗";
      dispatchNotification("chat:error", {});
      return false;
    }

    // Re-send the message
    const body: Record<string, string> = { message: outgoingMessage };

    const res = await fetch(
      `/api/stories/${encodeURIComponent(series)}/${encodeURIComponent(story)}/chat`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", ...getAuthHeaders() },
        body: JSON.stringify(body),
        signal: httpAbortController.signal,
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

export function useChatApi(): UseChatApiReturn {
  return {
    isLoading,
    errorMessage,
    streamingContent,
    sendMessage,
    resendMessage,
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

  const { isConnected, isAuthenticated, send, onMessage } = useWebSocket();

  isLoading.value = true;
  errorMessage.value = "";
  streamingContent.value = "";

  const series = opts.series ?? "";
  const name = opts.name ?? "";

  if (isConnected.value && isAuthenticated.value) {
    // ── WebSocket path ──
    const correlationId = crypto.randomUUID();
    currentPluginActionId = correlationId;

    return await new Promise<RunPluginPromptResult>((resolve, reject) => {
      const unsubDelta = onMessage("plugin-action:delta", (msg) => {
        if (msg.correlationId !== correlationId) return;
        streamingContent.value += msg.chunk;
      });
      const unsubDone = onMessage("plugin-action:done", (msg) => {
        if (msg.correlationId !== correlationId) return;
        cleanup();
        streamingContent.value = "";
        isLoading.value = false;
        if (msg.usage) useUsage().pushRecord(msg.usage);
        resolve({
          content: msg.content,
          usage: msg.usage,
          chapterUpdated: msg.chapterUpdated,
          appendedTag: msg.appendedTag,
        });
      });
      const unsubError = onMessage("plugin-action:error", (msg) => {
        if (msg.correlationId !== correlationId) return;
        cleanup();
        streamingContent.value = "";
        const detail = msg.problem?.detail
          ?? msg.problem?.title
          ?? "外掛操作失敗";
        errorMessage.value = detail;
        isLoading.value = false;
        reject(new Error(detail));
      });
      const unsubAborted = onMessage("plugin-action:aborted", (msg) => {
        if (msg.correlationId !== correlationId) return;
        cleanup();
        streamingContent.value = "";
        isLoading.value = false;
        const err = new DOMException(
          "Plugin action aborted.",
          "AbortError",
        );
        reject(err);
      });
      const stopWatchClose = watch(isConnected, (connected) => {
        if (!connected) {
          cleanup();
          streamingContent.value = "";
          errorMessage.value = "連線中斷";
          isLoading.value = false;
          reject(new Error("連線中斷"));
        }
      });

      const timeout = setTimeout(() => {
        cleanup();
        streamingContent.value = "";
        errorMessage.value = "請求逾時";
        isLoading.value = false;
        reject(new Error("請求逾時"));
      }, 300_000);

      function cleanup(): void {
        clearTimeout(timeout);
        stopWatchClose();
        unsubDelta();
        unsubDone();
        unsubError();
        unsubAborted();
        currentPluginActionId = null;
      }

      send({
        type: "plugin-action:run",
        correlationId,
        pluginName,
        series,
        name,
        promptFile,
        ...(opts.append !== undefined ? { append: opts.append } : {}),
        ...(opts.appendTag !== undefined ? { appendTag: opts.appendTag } : {}),
        ...(opts.extraVariables !== undefined
          ? { extraVariables: opts.extraVariables }
          : {}),
      });
    });
  }

  // ── HTTP fallback ──
  const { getAuthHeaders } = useAuth();
  httpAbortController = new AbortController();

  try {
    const body: Record<string, unknown> = {
      series,
      name,
      promptFile,
    };
    if (opts.append !== undefined) body.append = opts.append;
    if (opts.appendTag !== undefined) body.appendTag = opts.appendTag;
    if (opts.extraVariables !== undefined) {
      body.extraVariables = opts.extraVariables;
    }

    const res = await fetch(
      `/api/plugins/${encodeURIComponent(pluginName)}/run-prompt`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", ...getAuthHeaders() },
        body: JSON.stringify(body),
        signal: httpAbortController.signal,
      },
    );

    if (!res.ok) {
      let detail = `HTTP ${res.status}`;
      try {
        const problem = await res.json() as { detail?: string; title?: string };
        detail = problem?.detail ?? problem?.title ?? detail;
      } catch {
        // Body not JSON; keep status string.
      }
      errorMessage.value = detail;
      throw new Error(detail);
    }

    const result = await res.json() as RunPluginPromptResult;
    if (result?.usage) useUsage().pushRecord(result.usage);
    return result;
  } catch (err: unknown) {
    if (err instanceof DOMException && err.name === "AbortError") {
      throw err;
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
