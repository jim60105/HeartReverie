import { ref } from "vue";
import type { UseChatApiReturn } from "@/types";
import { useAuth } from "@/composables/useAuth";

const isLoading = ref(false);
const errorMessage = ref("");

async function sendMessage(
  series: string,
  story: string,
  message: string,
): Promise<boolean> {
  const { getAuthHeaders } = useAuth();
  isLoading.value = true;
  errorMessage.value = "";

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
  const { getAuthHeaders } = useAuth();
  isLoading.value = true;
  errorMessage.value = "";

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
    sendMessage,
    resendMessage,
  };
}
