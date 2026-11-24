import { defineConfig } from "vitest/config";

export default defineConfig({ test: {
  environment: "node", include: ["tests/db/**/*.test.ts"],
  fileParallelism: false, maxWorkers: 1, testTimeout: 10_000, hookTimeout: 30_000,
} });
