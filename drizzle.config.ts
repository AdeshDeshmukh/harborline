import { defineConfig } from "drizzle-kit";

// Generation only. Migration credentials are supplied to the explicit runner.
export default defineConfig({
  dialect: "postgresql",
  schema: "./src/server/db/schema.ts",
  out: "./drizzle",
  strict: true,
});
