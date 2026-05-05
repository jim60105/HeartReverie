import { computed, onScopeDispose, ref, type ComputedRef, type Ref } from "vue";
import { toolsChildren } from "@/router";

export interface ToolMenuItem {
  name: string;
  title: string;
}

export interface UseToolsReturn {
  tools: ComputedRef<ToolMenuItem[]>;
  isOpen: Ref<boolean>;
  open(): void;
  close(): void;
  toggle(): void;
  /** Allow consumers to register a callback invoked on outside click. */
  registerRootEl(getEl: () => HTMLElement | null): void;
}

const isOpen = ref(false);
let getRootEl: (() => HTMLElement | null) | null = null;
let docHandler: ((e: MouseEvent) => void) | null = null;

function tearDownDocHandler(): void {
  if (docHandler) {
    document.removeEventListener("click", docHandler, true);
    docHandler = null;
  }
}

function setUpDocHandler(): void {
  if (docHandler) return;
  docHandler = (e: MouseEvent) => {
    if (!isOpen.value) return;
    const root = getRootEl ? getRootEl() : null;
    const target = e.target as Node | null;
    if (root && target && root.contains(target)) return;
    isOpen.value = false;
    tearDownDocHandler();
  };
  document.addEventListener("click", docHandler, true);
}

export function useTools(): UseToolsReturn {
  const tools = computed<ToolMenuItem[]>(() =>
    toolsChildren
      .filter((r) => typeof r.name === "string" && r.meta?.title)
      .map((r) => ({
        name: r.name as string,
        title: r.meta!.title as string,
      })),
  );

  function open() {
    if (isOpen.value) return;
    isOpen.value = true;
    setUpDocHandler();
  }

  function close() {
    if (!isOpen.value) return;
    isOpen.value = false;
    tearDownDocHandler();
  }

  function toggle() {
    if (isOpen.value) close();
    else open();
  }

  function registerRootEl(getEl: () => HTMLElement | null) {
    getRootEl = getEl;
  }

  onScopeDispose(() => {
    // Tear down only when the last consumer unmounts; for simplicity we always
    // tear down on dispose (the dropdown is a single-instance component).
    tearDownDocHandler();
    isOpen.value = false;
    getRootEl = null;
  });

  return { tools, isOpen, open, close, toggle, registerRootEl };
}
