<script setup lang="ts">
import { computed, ref, onMounted } from "vue";
import { useRouter } from "vue-router";
import { settingsChildren } from "@/router";
import { useLastReadingRoute } from "@/composables/useLastReadingRoute";
import { apiFetch } from "@/lib/api";
import { useSidebarDrawer } from "@/composables/useSidebarDrawer";
import AppHeader from "./AppHeader.vue";

const router = useRouter();
const { lastReadingRoute } = useLastReadingRoute();

const {
  isOpen,
  isMobile,
  toggle,
  close,
  triggerRef,
  drawerRef,
  onKeydownTrap,
} = useSidebarDrawer();

const generalTabs = computed(() =>
  settingsChildren
    .filter((r) => r.name && r.meta?.title && (r.meta?.category ?? "general") === "general")
    .map((r) => ({
      name: r.name as string,
      title: r.meta!.title as string,
    }))
);

const developerToolsTabs = computed(() =>
  settingsChildren
    .filter((r) => r.name && r.meta?.title && r.meta?.category === "developer-tools")
    .map((r) => ({
      name: r.name as string,
      title: r.meta!.title as string,
    }))
);

interface PluginTab {
  pluginName: string;
  /** Sourced from the plugin manifest's `displayName` (zh-TW label), not the slug. */
  label: string;
}

const pluginTabs = ref<PluginTab[]>([]);

onMounted(async () => {
  try {
    const res = await apiFetch("/api/plugins", { throwOnError: false });
    if (res.ok) {
      const plugins = await res.json();
      pluginTabs.value = plugins
        .filter((p: Record<string, unknown>) => p.hasSettings)
        .map((p: Record<string, unknown>) => ({
          pluginName: p.name as string,
          label: (p.displayName as string),
        }));
    }
  } catch (err) {
    console.warn("[SettingsLayout] failed to fetch plugin list", err);
  }
});

function goBack() {
  const target = lastReadingRoute.value;
  if (target) {
    router.push(target);
  } else {
    router.push({ name: "home" });
  }
}

const drawerClosedOnMobile = computed(() => isMobile.value && !isOpen.value);

// Bindings consumed by template string refs (vue-tsc cannot detect string-ref usage).
void triggerRef;
void drawerRef;
</script>

<template>
  <div class="settings-layout">
    <AppHeader>
      <template v-if="isMobile" #leading>
        <button
          ref="triggerRef"
          type="button"
          class="drawer-toggle themed-btn header-btn header-btn--icon"
          aria-controls="settings-drawer"
          :aria-expanded="isOpen ? 'true' : 'false'"
          aria-label="開啟設定選單"
          @click="toggle"
        >
          ☰
        </button>
      </template>
    </AppHeader>

    <div class="settings-body">
      <div
        v-if="isOpen && isMobile"
        class="drawer-backdrop"
        @click="close"
      ></div>

      <aside
        id="settings-drawer"
        ref="drawerRef"
        class="settings-sidebar"
        :class="{ 'is-open': isOpen, 'is-mobile': isMobile }"
        :role="isMobile ? 'dialog' : undefined"
        :aria-modal="isMobile ? 'true' : undefined"
        :aria-labelledby="isMobile ? 'settings-drawer-label' : undefined"
        :aria-hidden="drawerClosedOnMobile ? 'true' : 'false'"
        :inert="drawerClosedOnMobile || undefined"
        @keydown="isOpen && isMobile ? onKeydownTrap($event) : undefined"
      >
        <h2 id="settings-drawer-label" class="visually-hidden">設定選單</h2>
        <button class="back-btn themed-btn" @click="goBack">← 返回閱讀</button>
        <nav class="sidebar-nav">
          <router-link
            v-for="tab in generalTabs"
            :key="tab.name"
            :to="{ name: tab.name }"
            class="sidebar-link"
            active-class="sidebar-link--active"
          >
            {{ tab.title }}
          </router-link>
          <template v-if="pluginTabs.length">
            <span class="sidebar-divider">插件</span>
            <router-link
              v-for="pt in pluginTabs"
              :key="pt.pluginName"
              :to="{ name: 'settings-plugin', params: { pluginName: pt.pluginName } }"
              class="sidebar-link"
              active-class="sidebar-link--active"
            >
              {{ pt.label }}
            </router-link>
          </template>
          <template v-if="developerToolsTabs.length">
            <span class="sidebar-divider">開發者工具</span>
            <router-link
              v-for="tab in developerToolsTabs"
              :key="tab.name"
              :to="{ name: tab.name }"
              class="sidebar-link"
              active-class="sidebar-link--active"
            >
              {{ tab.title }}
            </router-link>
          </template>
        </nav>
      </aside>
      <main class="settings-content">
        <router-view />
      </main>
    </div>
  </div>
</template>

<style scoped>
.settings-layout {
  display: flex;
  flex-direction: column;
  height: 100vh;
  height: 100dvh;
  min-height: 0;
  overflow: hidden;
  position: relative;
}

.settings-body {
  display: flex;
  flex: 1;
  min-height: 0;
  overflow: hidden;
  position: relative;
}

.settings-sidebar {
  display: flex;
  flex-direction: column;
  flex-shrink: 0;
  gap: 4px;
  border-right: 1px solid var(--border-color);
  background: var(--settings-sidebar-bg);
  padding: 16px 0;
  width: var(--settings-sidebar-width);
  min-height: 0;
  overflow-y: auto;
}

.back-btn {
  margin: 0 12px 12px;
  border: 1px solid var(--btn-border);
  border-radius: 4px;
  background: var(--btn-bg);
  padding: 8px 12px;
  color: var(--text-label);
  font-size: 0.875rem;
  font-family: var(--font-antique), var(--font-system-ui);
  text-align: left;
  cursor: pointer;
}

.sidebar-nav {
  display: flex;
  flex-direction: column;
}

.sidebar-link {
  padding: 10px 16px;
  border-left: 3px solid transparent;
  color: var(--text-label);
  text-decoration: none;
  font-size: 0.9rem;
  font-family: var(--font-antique), var(--font-system-ui);
  transition: background 0.15s, border-color 0.15s;
}

.sidebar-link:hover {
  background: var(--btn-active-bg);
}

.sidebar-link--active {
  border-left-color: var(--settings-sidebar-active-border);
  background: var(--settings-sidebar-active-bg);
  color: var(--text-name);
}

.sidebar-divider {
  display: block;
  padding: 8px 16px 4px;
  font-size: 0.75rem;
  color: var(--text-label);
  opacity: 0.7;
  font-family: var(--font-antique), var(--font-system-ui);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.settings-content {
  flex: 1;
  padding: var(--settings-content-padding);
  min-width: 0;
  min-height: 0;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
}

.drawer-toggle {
  display: none;
}

.drawer-backdrop {
  display: none;
}

.visually-hidden {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}

@media (max-width: 767px) {
  .drawer-toggle {
    display: inline-flex;
    align-items: center;
    justify-content: center;
  }

  .drawer-backdrop {
    display: block;
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.4);
    z-index: 7;
  }

  .settings-sidebar.is-mobile {
    position: fixed;
    top: var(--header-height, 3.5rem);
    left: 0;
    bottom: 0;
    width: min(280px, 80vw);
    z-index: 8;
    transform: translateX(-100%);
    transition: transform 0.2s ease;
    border-right: 1px solid var(--border-color);
    border-bottom: none;
    overflow-y: auto;
  }

  .settings-sidebar.is-mobile.is-open {
    transform: translateX(0);
  }

  .back-btn {
    margin: 0 12px 12px;
  }
}
</style>
