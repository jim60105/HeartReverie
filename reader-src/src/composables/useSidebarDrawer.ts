import { computed, nextTick, onBeforeUnmount, onMounted, ref, type Ref } from "vue";
import { useRouter } from "vue-router";
import { useMediaQuery } from "@/composables/useMediaQuery";

const MOBILE_QUERY = "(max-width: 767px)";
const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(",");

export interface UseSidebarDrawerReturn {
  isOpen: Ref<boolean>;
  isMobile: Ref<boolean>;
  open: () => void;
  close: () => void;
  toggle: () => void;
  /** Bind to the toggle button (`v-if="isMobile"`) — focus returns here on close. */
  triggerRef: Ref<HTMLElement | null>;
  /** Bind to the drawer `<aside>` element. Used for focus-trap calculations. */
  drawerRef: Ref<HTMLElement | null>;
  /** Attach to the drawer panel as `@keydown` to enforce a Tab focus trap. */
  onKeydownTrap: (event: KeyboardEvent) => void;
}

/**
 * Shared open/close logic for the mobile sidebar drawer used by
 * `SettingsLayout` and `ToolsLayout`. Owns:
 *
 *   - `isOpen` / `isMobile` reactive state
 *   - `open` / `close` / `toggle` actions
 *   - `Escape` keydown on `document` (closes only while open && mobile)
 *   - `router.afterEach` subscription that closes on every navigation
 *   - Focus management: on open the first focusable inside the drawer is
 *     focused; on close focus returns to the toggle button (via `triggerRef`)
 *   - `onKeydownTrap` helper that wraps `Tab` / `Shift+Tab` around the
 *     drawer's focusable set
 */
export function useSidebarDrawer(): UseSidebarDrawerReturn {
  const router = useRouter();
  const isOpen = ref(false);
  const isMobile = useMediaQuery(MOBILE_QUERY);
  const triggerRef = ref<HTMLElement | null>(null);
  const drawerRef = ref<HTMLElement | null>(null);

  const isMobileOpen = computed(() => isOpen.value && isMobile.value);

  function focusFirstInside(el: HTMLElement | null) {
    if (!el) return;
    const first = el.querySelector<HTMLElement>(FOCUSABLE_SELECTOR);
    first?.focus();
  }

  function open() {
    if (isOpen.value) return;
    isOpen.value = true;
    nextTick(() => focusFirstInside(drawerRef.value));
  }

  function close() {
    if (!isOpen.value) return;
    isOpen.value = false;
    nextTick(() => triggerRef.value?.focus());
  }

  function toggle() {
    if (isOpen.value) close();
    else open();
  }

  function getFocusables(): HTMLElement[] {
    const root = drawerRef.value;
    if (!root) return [];
    return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR))
      .filter((el) => !el.hasAttribute("disabled") && el.tabIndex !== -1);
  }

  function onKeydownTrap(event: KeyboardEvent) {
    if (event.key !== "Tab") return;
    const focusables = getFocusables();
    if (focusables.length === 0) return;
    const first = focusables[0]!;
    const last = focusables[focusables.length - 1]!;
    const active = (typeof document !== "undefined" ? document.activeElement : null) as
      | HTMLElement
      | null;

    if (event.shiftKey) {
      if (active === first || !active || !drawerRef.value?.contains(active)) {
        event.preventDefault();
        last.focus();
      }
    } else {
      if (active === last) {
        event.preventDefault();
        first.focus();
      }
    }
  }

  function onDocumentKeydown(event: KeyboardEvent) {
    if (event.key === "Escape" && isMobileOpen.value) {
      event.preventDefault();
      event.stopPropagation();
      close();
    }
  }

  let unregisterAfterEach: (() => void) | null = null;

  onMounted(() => {
    if (typeof document !== "undefined") {
      document.addEventListener("keydown", onDocumentKeydown);
    }
    // `router.afterEach` returns its own unregister function.
    unregisterAfterEach = router.afterEach(() => {
      if (isOpen.value) close();
    });
  });

  onBeforeUnmount(() => {
    if (typeof document !== "undefined") {
      document.removeEventListener("keydown", onDocumentKeydown);
    }
    if (unregisterAfterEach) {
      unregisterAfterEach();
      unregisterAfterEach = null;
    }
  });

  return {
    isOpen,
    isMobile,
    open,
    close,
    toggle,
    triggerRef,
    drawerRef,
    onKeydownTrap,
  };
}
