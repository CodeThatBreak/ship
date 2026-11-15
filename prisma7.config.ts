import path from "node:path";
import { defineConfig } from "prisma/config";

// Prisma 7 CLI config. The CLI does not auto-load .env, so DATABASE_URL is
// composed here from the same env the app reads (lib/config.ts mirrors this).
// DATABASE_URL overrides everything; the dev default matches docker-compose.yml.
const databaseUrl =
  process.env.DATABASE_URL ??
  "postgresql://devflow:devflow@localhost:5432/devflow";

export default defineConfig({
  schema: path.join(__dirname, "prisma/schema.prisma"),
  migrations: {
    path: path.join(__dirname, "prisma/migrations"),
  },
  datasource: {
    url: databaseUrl,
  },
});
