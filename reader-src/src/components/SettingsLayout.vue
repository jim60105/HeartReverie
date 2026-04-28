<script setup lang="ts">
import { computed } from "vue";
import { useRouter } from "vue-router";
import { settingsChildren } from "@/router";
import { useLastReadingRoute } from "@/composables/useLastReadingRoute";

const router = useRouter();
const { lastReadingRoute } = useLastReadingRoute();

const tabs = computed(() =>
  settingsChildren
    .filter((r) => r.name && r.meta?.title)
    .map((r) => ({
      name: r.name as string,
      title: r.meta!.title as string,
    })),
);

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
  background: rgba(180, 30, 60, 0.12);
}

.sidebar-link--active {
  border-left-color: var(--settings-sidebar-active-border);
  background: var(--settings-sidebar-active-bg);
  color: var(--text-name);
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
