// Copyright (C) 2026 Jim Chen <Jim@ChenJ.im>, licensed under AGPL-3.0-or-later
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU AFFERO GENERAL PUBLIC LICENSE as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
// GNU AFFERO GENERAL PUBLIC LICENSE for more details.
//
// You should have received a copy of the GNU AFFERO GENERAL PUBLIC LICENSE
// along with this program. If not, see <https://www.gnu.org/licenses/>.

import { ref } from "vue";
import type {
  NotifyOptions,
  ToastNotification,
  NotificationLevel,
  NotificationPosition,
  UseNotificationReturn,
} from "@/types";

const MAX_PER_POSITION = 5;
const DEFAULT_POSITION: NotificationPosition = "top-right";

function defaultDuration(level: NotificationLevel): number {
  return level === "warning" || level === "error" ? 8000 : 5000;
}

function hasNotificationApi(): boolean {
  return typeof globalThis !== "undefined"
    && typeof (globalThis as { Notification?: unknown }).Notification !== "undefined";
}

function readInitialPermission(): NotificationPermission | "unsupported" {
  if (!hasNotificationApi()) return "unsupported";
  try {
    return (globalThis as { Notification: { permission: NotificationPermission } })
      .Notification.permission;
  } catch {
    return "unsupported";
  }
}

// ── Singleton module-level state ──

const toasts = ref<ToastNotification[]>([]);
const permissionState = ref<NotificationPermission | "unsupported">(
  readInitialPermission(),
);
const timers = new Map<string, ReturnType<typeof setTimeout>>();

function generateId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `toast-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function enforceCap(position: NotificationPosition): void {
  const atPosition = toasts.value.filter((t) => t.position === position);
  if (atPosition.length <= MAX_PER_POSITION) return;
  const excess = atPosition.length - MAX_PER_POSITION;
  const toEvict = atPosition.slice(0, excess);
  for (const evicted of toEvict) {
    dismiss(evicted.id);
  }
}

function addToast(options: NotifyOptions): string {
  const id = generateId();
  const level: NotificationLevel = options.level ?? "info";
  const position: NotificationPosition = options.position ?? DEFAULT_POSITION;
  const duration = options.duration ?? defaultDuration(level);

  const toast: ToastNotification = {
    id,
    title: options.title,
    body: options.body,
    level,
    position,
    createdAt: Date.now(),
  };

  toasts.value = [...toasts.value, toast];
  enforceCap(position);

  if (duration > 0) {
    const timer = setTimeout(() => dismiss(id), duration);
    timers.set(id, timer);
  }

  return id;
}

function dismiss(id: string): void {
  const timer = timers.get(id);
  if (timer) {
    clearTimeout(timer);
    timers.delete(id);
  }
  toasts.value = toasts.value.filter((t) => t.id !== id);
}

function tryShowSystem(options: NotifyOptions): boolean {
  if (!hasNotificationApi()) return false;
  try {
    const NotifCtor = (globalThis as {
      Notification: new (title: string, options?: NotificationOptions) => Notification;
    }).Notification;
    new NotifCtor(options.title, { body: options.body });
    return true;
  } catch {
    return false;
  }
}

function isPageHidden(): boolean {
  if (typeof document === "undefined") return false;
  return document.visibilityState === "hidden";
}

async function requestPermission(): Promise<NotificationPermission> {
  if (!hasNotificationApi()) {
    permissionState.value = "unsupported";
    return "denied";
  }
  try {
    const result = await (globalThis as {
      Notification: { requestPermission: () => Promise<NotificationPermission> };
    }).Notification.requestPermission();
    permissionState.value = result;
    return result;
  } catch {
    permissionState.value = "denied";
    return "denied";
  }
}

function refreshPermission(): void {
  if (hasNotificationApi()) {
    try {
      permissionState.value = (globalThis as {
        Notification: { permission: NotificationPermission };
      }).Notification.permission;
    } catch { /* keep current */ }
  }
}

function notify(options: NotifyOptions): string {
  const channel = options.channel ?? "in-app";

  if (channel === "in-app") {
    return addToast(options);
  }

  // Re-read permission in case user changed it externally
  refreshPermission();

  if (channel === "system") {
    // Silently drop if denied/unsupported
    if (permissionState.value === "granted") {
      tryShowSystem(options);
      return "";
    }
    if (permissionState.value === "denied" || permissionState.value === "unsupported") {
      return "";
    }
    // permissionState === "default": prompt if visible, drop if hidden
    if (isPageHidden()) return "";
    void requestPermission().then((result) => {
      if (result === "granted") tryShowSystem(options);
    });
    return "";
  }

  // channel === "auto"
  if (permissionState.value === "granted") {
    if (tryShowSystem(options)) return "";
    return addToast(options);
  }

  if (permissionState.value === "denied" || permissionState.value === "unsupported") {
    return addToast(options);
  }

  // permissionState === "default"
  if (isPageHidden()) {
    // Don't prompt when page is hidden; fall back to in-app.
    return addToast(options);
  }

  // Page visible: request permission first, then deliver accordingly.
  void requestPermission().then((result) => {
    if (result === "granted") {
      tryShowSystem(options);
    } else {
      addToast(options);
    }
  });
  return "";
}

export function useNotification(): UseNotificationReturn {
  return {
    toasts,
    notify,
    dismiss,
    requestPermission,
    permissionState,
  };
}

/** Testing utility — reset singleton state. */
export function __resetNotificationStateForTests(): void {
  for (const timer of timers.values()) clearTimeout(timer);
  timers.clear();
  toasts.value = [];
  permissionState.value = readInitialPermission();
}
