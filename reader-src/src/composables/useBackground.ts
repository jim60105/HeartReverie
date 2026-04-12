import { ref } from "vue";
import type { UseBackgroundReturn } from "@/types";
import { useAuth } from "@/composables/useAuth";

const DEFAULT_BG = "/assets/heart.webp";

const backgroundUrl = ref("");

async function applyBackground(): Promise<void> {
  const { getAuthHeaders } = useAuth();
  try {
    const res = await fetch("/api/config", { headers: { ...getAuthHeaders() } });
    if (res.ok) {
      const data: { backgroundImage?: string } = await res.json();
      if (data.backgroundImage) {
        backgroundUrl.value = data.backgroundImage;
      }
    }
  } catch {
    // Fetch failed — use default
  }

  const url = backgroundUrl.value || DEFAULT_BG;
  document.body.style.backgroundImage = `url('${url}')`;
  document.body.style.backgroundSize = "cover";
  document.body.style.backgroundPosition = "center";
  document.body.style.backgroundRepeat = "no-repeat";
  document.body.style.backgroundAttachment = "fixed";
}

export function useBackground(): UseBackgroundReturn {
  return {
    backgroundUrl,
    applyBackground,
  };
}
