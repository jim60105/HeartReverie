<script setup lang="ts">
import { computed } from "vue";
import { useNotification } from "@/composables/useNotification";
import type { NotificationPosition, ToastNotification } from "@/types";

const { toasts, dismiss } = useNotification();

const POSITIONS: NotificationPosition[] = [
  "top-left",
  "top-right",
  "bottom-left",
  "bottom-right",
  "top-center",
  "bottom-center",
];

const groups = computed(() => {
  const map = new Map<NotificationPosition, ToastNotification[]>();
  for (const pos of POSITIONS) map.set(pos, []);
  for (const toast of toasts.value) {
    const list = map.get(toast.position);
    if (list) list.push(toast);
  }
  return map;
});

function levelIcon(level: ToastNotification["level"]): string {
  switch (level) {
    case "success": return "✓";
    case "warning": return "⚠";
    case "error": return "✕";
    default: return "ℹ";
  }
}

function ariaRole(level: ToastNotification["level"]): "alert" | "status" {
  return level === "error" || level === "warning" ? "alert" : "status";
}
</script>

<template>
  <div class="toast-root">
    <template v-for="pos in POSITIONS" :key="pos">
      <transition-group
        v-if="groups.get(pos)?.length"
        tag="div"
        :class="['toast-group', `toast-group--${pos}`]"
        name="toast"
      >
        <div
          v-for="toast in groups.get(pos)"
          :key="toast.id"
          :class="['toast', `toast--${toast.level}`]"
          :role="ariaRole(toast.level)"
          :aria-live="toast.level === 'error' || toast.level === 'warning' ? 'assertive' : 'polite'"
          aria-atomic="true"
        >
          <span class="toast__icon" aria-hidden="true">{{ levelIcon(toast.level) }}</span>
          <div class="toast__content">
            <div class="toast__title">{{ toast.title }}</div>
            <div v-if="toast.body" class="toast__body">{{ toast.body }}</div>
          </div>
          <button
            type="button"
            class="toast__close"
            aria-label="關閉通知"
            @click="dismiss(toast.id)"
          >
            ×
          </button>
        </div>
      </transition-group>
    </template>
  </div>
</template>

<style scoped>
.toast-root {
  position: fixed;
  inset: 0;
  pointer-events: none;
  z-index: 9999;
}

.toast-group {
  position: absolute;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  max-width: min(24rem, calc(100vw - 2rem));
  padding: 1rem;
  pointer-events: none;
}

.toast-group--top-left { top: 0; left: 0; }
.toast-group--top-right { top: 0; right: 0; }
.toast-group--bottom-left { bottom: 0; left: 0; flex-direction: column-reverse; }
.toast-group--bottom-right { bottom: 0; right: 0; flex-direction: column-reverse; }
.toast-group--top-center {
  top: 0;
  left: 50%;
  transform: translateX(-50%);
}
.toast-group--bottom-center {
  bottom: 0;
  left: 50%;
  transform: translateX(-50%);
  flex-direction: column-reverse;
}

.toast {
  display: flex;
  align-items: flex-start;
  gap: 0.75rem;
  padding: 0.75rem 1rem;
  border-radius: 0.5rem;
  background: rgba(24, 24, 27, 0.95);
  color: #f4f4f5;
  box-shadow: 0 10px 25px rgba(0, 0, 0, 0.25);
  border-left: 4px solid #3b82f6;
  pointer-events: auto;
  font-size: 0.9rem;
}

.toast--info { border-left-color: #3b82f6; }
.toast--success { border-left-color: #10b981; }
.toast--warning { border-left-color: #f59e0b; }
.toast--error { border-left-color: #ef4444; }

.toast__icon {
  flex-shrink: 0;
  font-weight: 600;
  font-size: 1rem;
  line-height: 1.25rem;
}

.toast--info .toast__icon { color: #60a5fa; }
.toast--success .toast__icon { color: #34d399; }
.toast--warning .toast__icon { color: #fbbf24; }
.toast--error .toast__icon { color: #f87171; }

.toast__content {
  flex: 1;
  min-width: 0;
}

.toast__title {
  font-weight: 600;
  line-height: 1.3;
}

.toast__body {
  margin-top: 0.25rem;
  opacity: 0.85;
  line-height: 1.4;
  word-wrap: break-word;
}

.toast__close {
  flex-shrink: 0;
  background: transparent;
  border: none;
  color: inherit;
  font-size: 1.25rem;
  line-height: 1;
  cursor: pointer;
  opacity: 0.6;
  padding: 0 0.25rem;
}

.toast__close:hover { opacity: 1; }

.toast-enter-active,
.toast-leave-active {
  transition: opacity 0.2s ease, transform 0.2s ease;
}
.toast-enter-from,
.toast-leave-to {
  opacity: 0;
  transform: translateY(-0.5rem);
}
</style>
