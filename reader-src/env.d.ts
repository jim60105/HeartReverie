/// <reference types="vite/client" />

declare module "*.vue" {
  import type { DefineComponent } from "vue";
  const component: DefineComponent<
    Record<string, unknown>,
    Record<string, unknown>,
    unknown
  >;
  export default component;
}

// File System Access API type augmentations
interface FileSystemDirectoryHandle {
  [Symbol.asyncIterator](): AsyncIterableIterator<
    [string, FileSystemFileHandle | FileSystemDirectoryHandle]
  >;
  entries(): AsyncIterableIterator<
    [string, FileSystemFileHandle | FileSystemDirectoryHandle]
  >;
  requestPermission(descriptor?: {
    mode?: "read" | "readwrite";
  }): Promise<PermissionState>;
}

interface Window {
  showDirectoryPicker(): Promise<FileSystemDirectoryHandle>;
}
