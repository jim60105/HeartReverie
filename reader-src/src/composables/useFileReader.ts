import { ref, shallowRef } from "vue";
import type { UseFileReaderReturn } from "@/types";

const DB_NAME = "storyReaderDB";
const STORE_NAME = "handles";
const HANDLE_KEY = "directoryHandle";

const isSupported = ref(false);
const directoryHandle = shallowRef<FileSystemDirectoryHandle | null>(null);
const files = ref<FileSystemFileHandle[]>([]);
const hasStoredHandle = ref(false);

// Check support on module load
if (typeof window !== "undefined" && "showDirectoryPicker" in window) {
  isSupported.value = true;
}

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function saveHandle(handle: FileSystemDirectoryHandle): Promise<void> {
  try {
    const db = await openDB();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      tx.objectStore(STORE_NAME).put(handle, HANDLE_KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    // IndexedDB unavailable — silently ignore
  }
}

async function openDirectory(): Promise<void> {
  try {
    const handle = await window.showDirectoryPicker();
    directoryHandle.value = handle;
    await saveHandle(handle);
    hasStoredHandle.value = true;

    // List chapter files
    const chapterPattern = /^\d+\.md$/;
    const entries: { name: string; handle: FileSystemFileHandle }[] = [];
    for await (const [name, entry] of handle) {
      if (entry.kind === "file" && chapterPattern.test(name)) {
        entries.push({ name, handle: entry as FileSystemFileHandle });
      }
    }
    entries.sort((a, b) => parseInt(a.name, 10) - parseInt(b.name, 10));
    files.value = entries.map((e) => e.handle);
  } catch (err) {
    if ((err as DOMException).name === "AbortError") return;
    throw err;
  }
}

async function restoreHandle(): Promise<boolean> {
  try {
    const db = await openDB();
    const handle = await new Promise<FileSystemDirectoryHandle | undefined>(
      (resolve, reject) => {
        const tx = db.transaction(STORE_NAME, "readonly");
        const req = tx.objectStore(STORE_NAME).get(HANDLE_KEY);
        req.onsuccess = () => resolve(req.result as FileSystemDirectoryHandle | undefined);
        req.onerror = () => reject(req.error);
      },
    );

    if (!handle) {
      hasStoredHandle.value = false;
      return false;
    }

    const permission = await handle.requestPermission({ mode: "read" });
    if (permission !== "granted") {
      hasStoredHandle.value = false;
      return false;
    }

    directoryHandle.value = handle;
    hasStoredHandle.value = true;

    // List chapter files
    const chapterPattern = /^\d+\.md$/;
    const entries: { name: string; handle: FileSystemFileHandle }[] = [];
    for await (const [name, entry] of handle) {
      if (entry.kind === "file" && chapterPattern.test(name)) {
        entries.push({ name, handle: entry as FileSystemFileHandle });
      }
    }
    entries.sort((a, b) => parseInt(a.name, 10) - parseInt(b.name, 10));
    files.value = entries.map((e) => e.handle);
    return true;
  } catch {
    hasStoredHandle.value = false;
    return false;
  }
}

async function readFile(handle: FileSystemFileHandle): Promise<string> {
  const file = await handle.getFile();
  return file.text();
}

async function clearStoredHandle(): Promise<void> {
  try {
    const db = await openDB();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      tx.objectStore(STORE_NAME).delete(HANDLE_KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    hasStoredHandle.value = false;
  } catch {
    // IndexedDB unavailable — silently ignore
  }
}

export function useFileReader(): UseFileReaderReturn {
  return {
    isSupported,
    directoryHandle,
    files,
    hasStoredHandle,
    openDirectory,
    restoreHandle,
    readFile,
    clearStoredHandle,
  };
}
