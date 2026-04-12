import { ref, watch } from "vue";
import type { UseChatApiReturn } from "@/types";
import { useAuth } from "@/composables/useAuth";
import { useWebSocket } from "@/composables/useWebSocket";

const isLoading = ref(false);
const errorMessage = ref("");
const streamingContent = ref("");

async function sendMessage(
  series: string,
  story: string,
  message: string,
): Promise<boolean> {
  const { isConnected, isAuthenticated, send, onMessage } = useWebSocket();
  isLoading.value = true;
  errorMessage.value = "";
  streamingContent.value = "";

  if (isConnected.value && isAuthenticated.value) {
    // ── WebSocket path ──
    const id = crypto.randomUUID();
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
        resolve(true);
      });
      const unsubError = onMessage('chat:error', (msg) => {
        if (msg.id !== id) return;
        cleanup();
        streamingContent.value = '';
        errorMessage.value = '發送失敗';
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
      }

      send({ type: 'chat:send', id, series, story, message });
    });
  }

  // ── HTTP fallback ──
  const { getAuthHeaders } = useAuth();

  try {
    const body: Record<string, string> = { message };

    const res = await fetch(
      `/api/stories/${encodeURIComponent(series)}/${encodeURIComponent(story)}/chat`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", ...getAuthHeaders() },
        body: JSON.stringify(body),
      },
    );

    if (!res.ok) {
      errorMessage.value = "發送失敗";
      return false;
    }

    return true;
  } catch {
    errorMessage.value = "發送失敗";
    return false;
  } finally {
    isLoading.value = false;
  }
}

async function resendMessage(
  series: string,
  story: string,
  message: string,
): Promise<boolean> {
  const { isConnected, isAuthenticated, send, onMessage } = useWebSocket();
  isLoading.value = true;
  errorMessage.value = "";
  streamingContent.value = "";

  if (isConnected.value && isAuthenticated.value) {
    // ── WebSocket path ──
    const id = crypto.randomUUID();
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
        resolve(true);
      });
      const unsubError = onMessage('chat:error', (msg) => {
        if (msg.id !== id) return;
        cleanup();
        streamingContent.value = '';
        errorMessage.value = '重送失敗';
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
      }

      send({ type: 'chat:resend', id, series, story, message });
    });
  }

  // ── HTTP fallback ──
  const { getAuthHeaders } = useAuth();

  try {
    // Delete last chapter
    const delRes = await fetch(
      `/api/stories/${encodeURIComponent(series)}/${encodeURIComponent(story)}/chapters/last`,
      { method: "DELETE", headers: { ...getAuthHeaders() } },
    );

    if (!delRes.ok && delRes.status !== 404) {
      errorMessage.value = "重送失敗";
      return false;
    }

    // Re-send the message
    const body: Record<string, string> = { message };

    const res = await fetch(
      `/api/stories/${encodeURIComponent(series)}/${encodeURIComponent(story)}/chat`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", ...getAuthHeaders() },
        body: JSON.stringify(body),
      },
    );

    if (!res.ok) {
      errorMessage.value = "重送失敗";
      return false;
    }

    return true;
  } catch {
    errorMessage.value = "重送失敗";
    return false;
  } finally {
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
  };
}
