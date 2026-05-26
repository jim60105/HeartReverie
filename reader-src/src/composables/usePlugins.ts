import { errorMessage } from "@/lib/errors";
import { ref } from "vue";
import type { HookHandler, HookStage, PluginDescriptor, UsePluginsReturn } from "@/types";
import { FrontendHookDispatcher, frontendHooks } from "@/lib/plugin-hooks";
import { apiFetch, apiFetchJson } from "@/lib/api";
import { useNotification } from "@/composables/useNotification";
import { renderDebug } from "@/lib/render-debug";
import { onEvent } from "@/lib/event-bus";

const plugins = ref<PluginDescriptor[]>([]);
const pluginsReady = ref(false);
const pluginsSettled = ref(false);
export const pluginSettingsStore = new Map<string, Record<string, unknown>>();
export const settingsRevision = ref(0);

let initPromise: Promise<void> | null = null;

let displayStripRegex: RegExp | null = null;
let settingsChangeSubscribed = false;
let reRenderTimer: ReturnType<typeof setTimeout> | null = null;

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) {
      deepFreeze(child);
    }
  }
  return value;
}

function cloneSettings(
  settings: Record<string, unknown>,
): Record<string, unknown> {
  return structuredClone(settings) as Record<string, unknown>;
}

export function updatePluginSettings(
  name: string,
  settings: Record<string, unknown>,
): void {
  pluginSettingsStore.set(name, cloneSettings(settings));
  settingsRevision.value++;
}

export function getPluginSettingsSync(name: string): Record<string, unknown> {
  const stored = pluginSettingsStore.get(name);
  return deepFreeze(stored ? cloneSettings(stored) : {});
}

function subscribeSettingsChanged(): void {
  if (settingsChangeSubscribed) return;
  settingsChangeSubscribed = true;
  onEvent("plugin-settings:changed", ({ name, settings }) => {
    updatePluginSettings(name, settings);

    const plugin = plugins.value.find((p) => p.name === name);
    const hasRenderContrib = plugin
      ? (plugin.hasFrontendModule || (plugin.displayStripTags?.length ?? 0) > 0)
      : true;

    if (hasRenderContrib) {
      if (reRenderTimer !== null) clearTimeout(reRenderTimer);
      reRenderTimer = globalThis.setTimeout(() => {
        reRenderTimer = null;
        // A settings change does not externally mutate the rendered DOM —
        // plugins re-walk the existing chapter and re-apply. Use the
        // notification-only helper so the v-html DOM is NOT remounted
        // (which would snap the scroll position).
        void import("@/composables/useChapterNav").then(({ useChapterNav }) => {
          const { notifyRenderInvalidated } = useChapterNav();
          notifyRenderInvalidated();
        }).catch((err: unknown) => {
          console.warn(
            "Failed to re-render after plugin settings change:",
            errorMessage(err),
          );
        });
      }, 50);
    }
  });
}

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
      const existing = Array.from(
        document.head.querySelectorAll('link[rel="stylesheet"]'),
      );
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
  const pluginList = await apiFetchJson<PluginDescriptor[]>(
    "/api/plugins",
    { errorMessage: "Failed to fetch /api/plugins" },
  );
  for (const plugin of pluginList) {
    if (plugin.settings && typeof plugin.settings === "object") {
      updatePluginSettings(plugin.name, plugin.settings);
    } else if (plugin.hasSettings) {
      try {
        const settingsRes = await apiFetch(
          `/api/plugins/${plugin.name}/settings`,
          { throwOnError: false },
        );
        if (settingsRes.ok) {
          updatePluginSettings(plugin.name, await settingsRes.json());
        }
      } catch (err: unknown) {
        console.warn(
          `Failed to hydrate plugin settings for ${plugin.name}:`,
          errorMessage(err),
        );
      }
    }
  }
  subscribeSettingsChanged();

  compileDisplayStripPatterns(pluginList);
  injectPluginStyles(pluginList);

  const frontendPlugins = pluginList.filter((p) => p.hasFrontendModule);

  // Build a per-plugin proxy that auto-curries `originPluginName` into
  // `register()` (and `on()` for plugins that prefer the alias). Existing
  // plugins that pass extra arguments keep working unchanged because the
  // proxy forwards everything else verbatim.
  function makePluginHooksProxy(originPluginName: string) {
    return new Proxy(frontendHooks, {
      get(target, prop, receiver) {
        if (prop === "register" || prop === "on") {
          return (
            stage: HookStage,
            handler: HookHandler<unknown>,
            priority?: number,
          ) => target.register(stage, handler, priority, originPluginName);
        }
        if (prop === "getSettings") {
          return (otherName?: string) => getPluginSettingsSync(otherName ?? originPluginName);
        }
        return Reflect.get(target, prop, receiver);
      },
    });
  }

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
        const getSettings = (otherName?: string) => getPluginSettingsSync(otherName ?? p.name);
        const { notify } = useNotification();
        await Promise.resolve(
          mod.register(makePluginHooksProxy(p.name), { getSettings, notify }),
        );
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

  // After every plugin has finished register(), run the declare-vs-register
  // cross-check for frontend stages. Non-fatal: mismatches are surfaced via
  // a notification banner and retained on the dispatcher for the inspector.
  try {
    const declarations = pluginList
      .filter((p) => Array.isArray(p.hooks))
      .map((p) => ({
        plugin: p.name,
        hooks: (p.hooks ?? []).map((h) => ({ stage: h.stage })),
      }));
    frontendHooks.finalizeBoot(declarations);
  } catch (err) {
    console.warn(
      "FrontendHookDispatcher.finalizeBoot() threw unexpectedly:",
      err instanceof Error ? err.message : err,
    );
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
    getPluginSettingsSync,
  };
}
