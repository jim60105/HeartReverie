import { ref } from "vue";
import type { UsePluginsReturn, PluginDescriptor } from "@/types";
import { FrontendHookDispatcher, frontendHooks } from "@/lib/plugin-hooks";
import { useAuth } from "@/composables/useAuth";

const plugins = ref<PluginDescriptor[]>([]);
const initialized = ref(false);

let displayStripRegex: RegExp | null = null;

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function isRegexSafe(pattern: string): boolean {
  const probe = "a".repeat(25) + "!";
  try {
    const re = new RegExp(pattern);
    const start = performance.now();
    re.test(probe);
    return performance.now() - start < 100;
  } catch {
    return false;
  }
}

function compileDisplayStripPatterns(pluginList: PluginDescriptor[]): void {
  const patterns: string[] = [];

  for (const p of pluginList) {
    if (!Array.isArray(p.displayStripTags)) continue;
    for (const tag of p.displayStripTags) {
      if (typeof tag !== "string" || tag.length === 0) continue;

      if (tag.startsWith("/")) {
        // Regex pattern: extract inner pattern from /pattern/flags
        const lastSlash = tag.lastIndexOf("/");
        if (lastSlash <= 0) continue;
        const inner = tag.slice(1, lastSlash);
        if (inner.length === 0) continue;
        try {
          new RegExp(inner);
          if (!isRegexSafe(inner)) continue;
          patterns.push(inner);
        } catch {
          // Invalid regex — skip
        }
      } else {
        // Plain tag name: auto-wrap
        patterns.push(`<${escapeRegex(tag)}>[\\s\\S]*?</${escapeRegex(tag)}>`);
      }
    }
  }

  if (patterns.length > 0) {
    displayStripRegex = new RegExp(patterns.join("|"), "gi");
  }
}

function applyDisplayStrip(text: string): string {
  if (!displayStripRegex) return text;
  return text.replace(displayStripRegex, "");
}

function injectPluginStyles(pluginList: PluginDescriptor[]): void {
  for (const p of pluginList) {
    if (!Array.isArray(p.frontendStyles) || p.frontendStyles.length === 0) {
      continue;
    }
    for (const href of p.frontendStyles) {
      if (typeof href !== "string" || href.length === 0) continue;
      // Deduplicate by comparing href attribute directly (avoids querySelector injection)
      const existing = Array.from(document.head.querySelectorAll("link[rel=\"stylesheet\"]"));
      if (existing.some((el) => el.getAttribute("href") === href)) continue;

      const link = document.createElement("link");
      link.rel = "stylesheet";
      link.href = href;
      link.dataset.plugin = p.name;
      link.onerror = () => link.remove();
      document.head.appendChild(link);
    }
  }
}

async function initPlugins(): Promise<void> {
  if (initialized.value) return;
  const { getAuthHeaders } = useAuth();

  try {
    const res = await fetch("/api/plugins", { headers: { ...getAuthHeaders() } });
    if (!res.ok) return;
    const pluginList: PluginDescriptor[] = await res.json();

    compileDisplayStripPatterns(pluginList);

    injectPluginStyles(pluginList);

    const frontendPlugins = pluginList.filter((p) => p.hasFrontendModule);

    await Promise.all(
      frontendPlugins.map(async (p) => {
        try {
          const mod = await import(
            /* @vite-ignore */ `/plugins/${p.name}/frontend.js`
          );
          if (typeof mod.register === "function") {
            mod.register(frontendHooks);
          }
        } catch {
          // Failed to load plugin — silently ignore
        }
      }),
    );

    plugins.value = pluginList;
    initialized.value = true;
  } catch {
    // Plugin loading failed — silently ignore
  }
}

export { FrontendHookDispatcher };

export function usePlugins(): UsePluginsReturn {
  return {
    plugins,
    initialized,
    initPlugins,
    applyDisplayStrip,
  };
}
