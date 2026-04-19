import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import { resolve } from "node:path";

export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      "@": resolve(import.meta.dirname!, "src"),
    },
  },
  build: {
    outDir: "../reader-dist",
    emptyOutDir: true,
    sourcemap: true,
  },
  server: {
    proxy: {
      "/api": {
        target: "https://localhost:8443",
        secure: false,
        changeOrigin: true,
      },
      "/plugins": {
        target: "https://localhost:8443",
        secure: false,
        changeOrigin: true,
      },
      "/assets": {
        target: "https://localhost:8443",
        secure: false,
        changeOrigin: true,
      },
      "/js": {
        target: "https://localhost:8443",
        secure: false,
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
      reporter: ["text-summary", "lcovonly"],
      exclude: ["src/__tests__/setup.ts"],
    },
  },
});
