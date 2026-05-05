<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useTools } from "@/composables/useTools";

const router = useRouter();
const route = useRoute();
const { tools, isOpen, toggle, open, close, registerRootEl } = useTools();

const rootEl = ref<HTMLElement | null>(null);
const triggerEl = ref<HTMLButtonElement | null>(null);
const panelEl = ref<HTMLElement | null>(null);

registerRootEl(() => rootEl.value);

function onSelect(name: string) {
  close();
  router.push({ name });
}

function getMenuItems(): HTMLElement[] {
  if (!panelEl.value) return [];
  return Array.from(
    panelEl.value.querySelectorAll<HTMLElement>(".tools-menu__item"),
  );
}

function focusItemAt(index: number) {
  const items = getMenuItems();
  if (items.length === 0) return;
  const i = ((index % items.length) + items.length) % items.length;
  items[i]!.focus();
}

async function onTriggerKeydown(e: KeyboardEvent) {
  if (e.key === "ArrowDown" || e.key === "Enter" || e.key === " ") {
    if (!isOpen.value) {
      e.preventDefault();
      open();
      await nextTick();
      focusItemAt(0);
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      focusItemAt(0);
    }
  } else if (e.key === "ArrowUp" && !isOpen.value) {
    e.preventDefault();
    open();
    await nextTick();
    const items = getMenuItems();
    focusItemAt(items.length - 1);
  }
}

function onPanelKeydown(e: KeyboardEvent) {
  const items = getMenuItems();
  if (items.length === 0) return;
  const active = document.activeElement as HTMLElement | null;
  const idx = active ? items.indexOf(active) : -1;
  if (e.key === "ArrowDown") {
    e.preventDefault();
    focusItemAt(idx === -1 ? 0 : idx + 1);
  } else if (e.key === "ArrowUp") {
    e.preventDefault();
    focusItemAt(idx === -1 ? items.length - 1 : idx - 1);
  } else if (e.key === "Home") {
    e.preventDefault();
    focusItemAt(0);
  } else if (e.key === "End") {
    e.preventDefault();
    focusItemAt(items.length - 1);
  }
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === "Escape" && isOpen.value) {
    e.stopPropagation();
    close();
    triggerEl.value?.focus();
  }
}

onMounted(() => {
  document.addEventListener("keydown", onKeydown, true);
});

onBeforeUnmount(() => {
  document.removeEventListener("keydown", onKeydown, true);
});

// Close on route change.
watch(
  () => route.fullPath,
  () => {
    if (isOpen.value) close();
  },
);
</script>

<template>
  <div ref="rootEl" class="tools-menu">
    <button
      ref="triggerEl"
      type="button"
      class="themed-btn header-btn header-btn--icon"
      title="工具"
      aria-haspopup="menu"
      :aria-expanded="isOpen"
      @click.stop="toggle"
      @keydown="onTriggerKeydown"
    >
      🧰
    </button>
    <div
      v-if="isOpen"
      ref="panelEl"
      class="tools-menu__panel"
      role="menu"
      @keydown="onPanelKeydown"
    >
      <router-link
        v-for="tool in tools"
        :key="tool.name"
        :to="{ name: tool.name }"
        class="tools-menu__item"
        role="menuitem"
        @click="onSelect(tool.name)"
      >
        {{ tool.title }}
      </router-link>
    </div>
  </div>
</template>

<style scoped>
.tools-menu {
  position: relative;
  display: inline-flex;
}

/*
 * Mirror AppHeader.vue's `.header-btn` / `.header-btn--icon` rules so the
 * trigger picks them up despite Vue scoped-CSS isolation (parent scoped
 * styles do not reach descendant components, only the child's root).
 */
.tools-menu .header-btn {
  background: var(--btn-bg);
  border: 1px solid var(--btn-border);
  color: var(--text-name);
  padding: 4px 8px;
  border-radius: 4px;
  font-size: 0.875rem;
  font-weight: 500;
  cursor: pointer;
  white-space: nowrap;
  transition: background 0.15s, border-color 0.15s;
}

.tools-menu .header-btn--icon {
  font-size: 1rem;
}

.tools-menu__panel {
  position: absolute;
  top: calc(100% + 10px);
  right: 0;
  min-width: 180px;
  max-width: min(280px, 90vw);
  background: var(--btn-bg);
  border: 1px solid var(--btn-border);
  border-radius: 4px;
  box-shadow: 0 6px 16px rgba(0, 0, 0, 0.18);
  padding: 4px 0;
  z-index: 11;
  display: flex;
  flex-direction: column;
}

.tools-menu__item {
  display: block;
  padding: 8px 14px;
  color: var(--text-name);
  text-decoration: none;
  font-size: 0.875rem;
  font-family: var(--font-antique), var(--font-system-ui);
  white-space: nowrap;
}

.tools-menu__item:hover {
  background: var(--btn-active-bg);
}
</style>
