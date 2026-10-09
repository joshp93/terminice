import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  resolve: {
    alias: { "@test": fileURLToPath(new URL("./src/test", import.meta.url)) },
  },
  server: {
    port: 1420,
    strictPort: true,
    watch: { ignored: ["**/src-tauri/**"] },
  },
  test: {
    environment: "jsdom",
    setupFiles: ["src/test/setup.ts"],
    include: ["src/**/*.test.{ts,tsx}"],
    restoreMocks: true,
    // jsdom costs a couple of seconds to build and there are sixty test files,
    // which was most of the suite's wall clock. This pool builds one environment
    // per worker and hands it to every file that worker runs, while each file
    // still gets a fresh module registry of its own — so the mocking every file
    // does at the top, and the module state behind it, stays that file's own.
    pool: "vmThreads",
  },
});
