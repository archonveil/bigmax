import path from "node:path";
import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

const dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(dirname, "./src"),
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    // Exclude e2e (Playwright owns that) и Next-специфичные бандлы.
    exclude: ["node_modules", ".next", "e2e"],
    // Полифилл localStorage для zustand/persist — до module-init.
    setupFiles: ["./vitest.setup.ts"],
  },
});
