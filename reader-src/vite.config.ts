import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import { resolve } from "node:path";

export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      "@": resolve(import.meta.dirname!, "src"),
      "@plugins-ext": resolve(import.meta.dirname!, "../../HeartReverie_Plugins"),
    },
  },
  build: {
    outDir: "../reader-dist",
    emptyOutDir: true,
    sourcemap: true,
  },
  server: {
    fs: {
      allow: [".", "../../HeartReverie_Plugins"],
    },
    proxy: {
      "/api": {
        target: "http://localhost:8080",
        changeOrigin: true,
      },
      "/plugins": {
        target: "http://localhost:8080",
        changeOrigin: true,
      },
      "/assets": {
        target: "http://localhost:8080",
        changeOrigin: true,
      },
      "/js": {
        target: "http://localhost:8080",
        changeOrigin: true,
      },
    },
  },
  test: {
    environment: "happy-dom",
    include: ["src/**/__tests__/**/*.test.ts"],
    globals: true,
    coverage: {
      provider: "v8",
      reportsDirectory: "../coverage/frontend",
      reporter: ["text-summary", "lcovonly", "json-summary"],
      exclude: ["src/__tests__/setup.ts"],
    },
  },
});
