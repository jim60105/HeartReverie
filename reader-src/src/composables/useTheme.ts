import { ref } from "vue";
import type { ThemePayload, UseThemeReturn } from "@/types";
import { apiFetch, apiFetchJson } from "@/lib/api";

const STORAGE_KEY_ID = "heartReverie.themeId";
const STORAGE_KEY_CACHE_PREFIX = "heartReverie.themeCache.";

const currentThemeId = ref<string>(
  localStorage.getItem(STORAGE_KEY_ID) || "default",
);
const themes = ref<Array<{ id: string; label: string }>>([]);

function applyHighlightOverride(color: string): void {
  const id = "theme-highlight-override";
  let style = document.getElementById(id) as HTMLStyleElement | null;
  if (!style) {
    style = document.createElement("style");
    style.id = id;
    document.head.appendChild(style);
  }
  style.textContent = "::highlight(dialogue-quote-straight)," +
    "::highlight(dialogue-quote-curly)," +
    "::highlight(dialogue-quote-guillemet)," +
    "::highlight(dialogue-quote-corner)," +
    "::highlight(dialogue-quote-corner-half)," +
    "::highlight(dialogue-quote-book){color:" +
    color +
    "!important}";
}

function applyTheme(theme: ThemePayload): void {
  const root = document.documentElement;
  for (const [name, value] of Object.entries(theme.palette)) {
    root.style.setProperty(name, value);
  }
  if (theme.colorScheme) {
    root.style.setProperty("color-scheme", theme.colorScheme);
  }
  // backgroundImage is a raw CSS value (e.g. "url('/assets/heart.webp')" or gradient)
  document.body.style.backgroundImage = theme.backgroundImage || "none";
  // ::highlight() pseudo-elements cannot resolve var() from ancestors;
  // inject literal color so dialogue-colorize plugin respects the theme.
  const textName = theme.palette["--text-name"];
  if (textName) applyHighlightOverride(textName);
}

async function listThemes(): Promise<void> {
  try {
    themes.value = await apiFetchJson<Array<{ id: string; label: string }>>(
      "/api/themes",
    );
  } catch { /* Network or non-2xx — leave empty */ }
}

async function selectTheme(id: string): Promise<void> {
  try {
    const res = await apiFetch(
      `/api/themes/${encodeURIComponent(id)}`,
      { throwOnError: false },
    );
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
