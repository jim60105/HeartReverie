<script setup lang="ts">
import { computed } from "vue";
import { useRouter } from "vue-router";
import { toolsChildren } from "@/router";
import { useLastReadingRoute } from "@/composables/useLastReadingRoute";
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

const tabs = computed(() =>
  toolsChildren
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

const drawerClosedOnMobile = computed(() => isMobile.value && !isOpen.value);
</script>

<template>
  <div class="tools-layout">
    <AppHeader>
      <template v-if="isMobile" #leading>
        <button
          ref="triggerRef"
          type="button"
          class="drawer-toggle themed-btn header-btn header-btn--icon"
          aria-controls="tools-drawer"
          :aria-expanded="isOpen ? 'true' : 'false'"
          aria-label="開啟工具選單"
          @click="toggle"
        >
          ☰
        </button>
      </template>
    </AppHeader>

    <div class="tools-body">
      <div
        v-if="isOpen && isMobile"
        class="drawer-backdrop"
        @click="close"
      ></div>

      <aside
        id="tools-drawer"
        ref="drawerRef"
        class="tools-sidebar"
        :class="{ 'is-open': isOpen, 'is-mobile': isMobile }"
        :role="isMobile ? 'dialog' : undefined"
        :aria-modal="isMobile ? 'true' : undefined"
        :aria-labelledby="isMobile ? 'tools-drawer-label' : undefined"
        :aria-hidden="drawerClosedOnMobile ? 'true' : 'false'"
        :inert="drawerClosedOnMobile || undefined"
        @keydown="isOpen && isMobile ? onKeydownTrap($event) : undefined"
      >
        <h2 id="tools-drawer-label" class="visually-hidden">工具選單</h2>
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
      <main class="tools-content">
        <router-view />
      </main>
    </div>
  </div>
</template>

<style scoped>
.tools-layout {
  display: flex;
  flex-direction: column;
  min-height: 100vh;
  position: relative;
}

.tools-body {
  display: flex;
  flex: 1;
  min-height: 0;
  position: relative;
}

.tools-sidebar {
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

.tools-content {
  flex: 1;
  padding: var(--settings-content-padding);
  min-width: 0;
  min-height: 0;
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

  .tools-sidebar.is-mobile {
    position: fixed;
    top: var(--header-height, 3.5rem);
    left: 0;
    bottom: 0;
    width: min(280px, 80vw);
    z-index: 8;
    transform: translateX(-100%);
    transition: transform 0.2s ease;
    border-right: 1px solid var(--border-color);
    overflow-y: auto;
  }

  .tools-sidebar.is-mobile.is-open {
    transform: translateX(0);
  }
}
</style>
