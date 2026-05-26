import { onBeforeUnmount, onMounted, type Ref, ref } from "vue";

/**
 * Reactive wrapper around `window.matchMedia`. Returns a `Ref<boolean>` that
 * tracks the supplied media query and updates whenever the match state
 * changes. Cleanup is automatic on component unmount.
 *
 * Falls back to `false` in environments without `window.matchMedia` (SSR,
 * older test runners that don't polyfill it).
 */
export function useMediaQuery(query: string): Ref<boolean> {
  const matches = ref(false);

  if (typeof window === "undefined" || typeof globalThis.matchMedia !== "function") {
    return matches;
  }

  const mql = globalThis.matchMedia(query);
  matches.value = mql.matches;

  const handler = (event: MediaQueryListEvent) => {
    matches.value = event.matches;
  };

  onMounted(() => {
    mql.addEventListener("change", handler);
    matches.value = mql.matches;
  });

  onBeforeUnmount(() => {
    mql.removeEventListener("change", handler);
  });

  return matches;
}
