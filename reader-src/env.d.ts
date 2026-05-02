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

// Minimal ambient declarations for Node builtins used by parity tests.
// (The reader-src toolchain doesn't depend on @types/node; we only need
// readFileSync + path/url helpers in test code that runs under Vitest/Deno.)
declare module "node:fs" {
  export function readFileSync(path: string, encoding: string): string;
}
declare module "node:url" {
  export function fileURLToPath(url: string | URL): string;
}
declare module "node:path" {
  export function dirname(p: string): string;
  export function resolve(...paths: string[]): string;
}
