<script setup lang="ts">
import { computed, ref, onMounted } from "vue";
import { useRouter } from "vue-router";
import { settingsChildren } from "@/router";
import { useLastReadingRoute } from "@/composables/useLastReadingRoute";
import { useAuth } from "@/composables/useAuth";

const router = useRouter();
const { lastReadingRoute } = useLastReadingRoute();
const { getAuthHeaders } = useAuth();

const tabs = computed(() =>
  settingsChildren
    .filter((r) => r.name && r.meta?.title)
    .map((r) => ({
      name: r.name as string,
      title: r.meta!.title as string,
    })),
);

interface PluginTab {
  pluginName: string;
  label: string;
}

const pluginTabs = ref<PluginTab[]>([]);

onMounted(async () => {
  try {
    const res = await fetch("/api/plugins", { headers: getAuthHeaders() as Record<string, string> });
    if (res.ok) {
      const plugins = await res.json();
      pluginTabs.value = plugins
        .filter((p: Record<string, unknown>) => p.hasSettings)
        .map((p: Record<string, unknown>) => ({
          pluginName: p.name as string,
          label: (p.name as string),
        }));
    }
  } catch {
    // Plugin list unavailable — sidebar won't show plugin links
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
</script>

<template>
  <div class="settings-layout">
    <aside class="settings-sidebar">
      <button class="back-btn themed-btn" @click="goBack">← 返回閱讀</button>
      <nav class="sidebar-nav">
        <router-link
          v-for="tab in tabs"
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
      </nav>
    </aside>
    <main class="settings-content">
      <router-view />
    </main>
  </div>
</template>

<style scoped>
.settings-layout {
  display: flex;
  min-height: 100vh;
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
  display: flex;
  flex-direction: column;
}

@media (max-width: 767px) {
  .settings-layout {
    flex-direction: column;
  }

  .settings-sidebar {
    width: 100%;
    flex-direction: row;
    flex-wrap: wrap;
    align-items: center;
    padding: 8px 12px;
    gap: 8px;
    border-right: none;
    border-bottom: 1px solid var(--border-color);
  }

  .back-btn {
    margin: 0;
  }

  .sidebar-nav {
    flex-direction: row;
    gap: 4px;
  }

  .sidebar-link {
    border-left: none;
    border-bottom: 2px solid transparent;
    padding: 6px 12px;
  }

  .sidebar-link--active {
    border-left-color: transparent;
    border-bottom-color: var(--settings-sidebar-active-border);
  }
}
</style>
