import { ref } from "vue";
import type { UsePluginsReturn, PluginDescriptor } from "@/types";
import { FrontendHookDispatcher, frontendHooks } from "@/lib/plugin-hooks";
import { useAuth } from "@/composables/useAuth";
import { useNotification } from "@/composables/useNotification";
import { renderDebug } from "@/lib/render-debug";

const plugins = ref<PluginDescriptor[]>([]);
const pluginsReady = ref(false);
const pluginsSettled = ref(false);

let initPromise: Promise<void> | null = null;

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

async function doInit(): Promise<void> {
  const { getAuthHeaders } = useAuth();

  const res = await fetch("/api/plugins", { headers: { ...getAuthHeaders() } });
  if (!res.ok) {
    throw new Error(`Failed to fetch /api/plugins: HTTP ${res.status}`);
  }
  const pluginList: PluginDescriptor[] = await res.json();

  compileDisplayStripPatterns(pluginList);
  injectPluginStyles(pluginList);

  const frontendPlugins = pluginList.filter((p) => p.hasFrontendModule);

  // Use allSettled so every plugin gets a chance to register, but track
  // failures so we can fail the overall init and keep pluginsReady false.
  const results = await Promise.allSettled(
    frontendPlugins.map(async (p) => {
      const mod = await import(
        /* @vite-ignore */ `/plugins/${p.name}/frontend.js`
      );
      if (typeof mod.register === "function") {
        // Honor async register() functions so plugins that load resources
        // before registering handlers complete before pluginsReady flips.
        await Promise.resolve(mod.register(frontendHooks));
      }
    }),
  );

  plugins.value = pluginList;

  const failures: { name: string; reason: unknown }[] = [];
  results.forEach((res, idx) => {
    if (res.status === "rejected") {
      const name = frontendPlugins[idx]?.name ?? "<unknown>";
      console.warn(
        `Failed to load frontend plugin "${name}":`,
        res.reason instanceof Error ? res.reason.message : res.reason,
      );
      failures.push({ name, reason: res.reason });
    }
  });

  if (failures.length > 0) {
    const names = failures.map((f) => f.name).join(", ");
    throw new Error(`Frontend plugin initialization failed: ${names}`);
  }
}

async function initPlugins(): Promise<void> {
  if (pluginsSettled.value) return;
  if (initPromise) return initPromise;

  initPromise = (async () => {
    try {
      await doInit();
      pluginsReady.value = true;
    } catch (err) {
      console.warn(
        "Plugin initialization failed:",
        err instanceof Error ? err.message : err,
      );
      try {
        const { notify } = useNotification();
        notify({
          title: "外掛載入失敗",
          body: "部分或全部外掛無法載入，將以無外掛模式繼續顯示。",
          level: "warning",
        });
      } catch {
        // Notification system unavailable — already logged above.
      }
    } finally {
      pluginsSettled.value = true;
      renderDebug("plugins-settled", {
        ready: pluginsReady.value,
        settled: pluginsSettled.value,
        pluginCount: plugins.value.length,
      });
    }
  })();

  return initPromise;
}

export { FrontendHookDispatcher };

export function usePlugins(): UsePluginsReturn {
  return {
    plugins,
    pluginsReady,
    pluginsSettled,
    initPlugins,
    applyDisplayStrip,
  };
}
