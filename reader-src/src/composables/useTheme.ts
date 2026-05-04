import { ref } from "vue";
import type { UseThemeReturn, ThemePayload } from "@/types";
import { useAuth } from "@/composables/useAuth";

const STORAGE_KEY_ID = "heartReverie.themeId";
const STORAGE_KEY_CACHE_PREFIX = "heartReverie.themeCache.";

const currentThemeId = ref<string>(
  localStorage.getItem(STORAGE_KEY_ID) || "default",
);
const themes = ref<Array<{ id: string; label: string }>>([]);

function escapeForCssUrl(value: string): string {
  return value.replace(/'/g, "\\'");
}

function applyTheme(theme: ThemePayload): void {
  const root = document.documentElement;
  for (const [name, value] of Object.entries(theme.palette)) {
    root.style.setProperty(name, value);
  }
  if (theme.colorScheme) {
    root.style.setProperty("color-scheme", theme.colorScheme);
  }
  document.body.style.backgroundImage = theme.backgroundImage
    ? `url('${escapeForCssUrl(theme.backgroundImage)}')`
    : "";
}

async function listThemes(): Promise<void> {
  const { getAuthHeaders } = useAuth();
  try {
    const res = await fetch("/api/themes", { headers: { ...getAuthHeaders() } });
    if (res.ok) {
      themes.value = await res.json();
    }
  } catch { /* Network error — leave empty */ }
}

async function selectTheme(id: string): Promise<void> {
  const { getAuthHeaders } = useAuth();
  try {
    const res = await fetch(`/api/themes/${encodeURIComponent(id)}`, {
      headers: { ...getAuthHeaders() },
    });
    if (res.ok) {
      const theme: ThemePayload = await res.json();
      applyTheme(theme);
      currentThemeId.value = id;
      localStorage.setItem(STORAGE_KEY_ID, id);
      localStorage.setItem(
        STORAGE_KEY_CACHE_PREFIX + id,
        JSON.stringify(theme),
      );
    } else if (res.status === 404) {
      // Stale id — fall back to default (guard against recursion)
      localStorage.removeItem(STORAGE_KEY_ID);
      currentThemeId.value = "default";
      if (id !== "default") {
        await selectTheme("default");
      }
    }
  } catch { /* Network error — keep current */ }
}

async function applyOnMount(): Promise<void> {
  const id = localStorage.getItem(STORAGE_KEY_ID) || "default";
  currentThemeId.value = id;
  await selectTheme(id);
}

export function useTheme(): UseThemeReturn {
  return { currentThemeId, themes, listThemes, applyTheme, selectTheme, applyOnMount };
}
