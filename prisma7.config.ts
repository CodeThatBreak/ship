import fs from "node:fs";
import path from "node:path";
import { defineConfig } from "prisma/config";

// Prisma 7 CLI config. The CLI does not auto-load .env, so the repo `.env` is
// loaded here before anything reads DATABASE_URL — otherwise `prisma migrate`
// silently falls back to the built-in default and can target a different
// Postgres instance than the app does.
const repoRoot = __dirname;
const envFile = path.join(repoRoot, ".env");
if (fs.existsSync(envFile)) process.loadEnvFile(envFile);

// DATABASE_URL overrides everything; the dev default matches docker-compose.yml.
const databaseUrl =
  process.env.DATABASE_URL ?? "postgresql://devflow:devflow@localhost:5432/devflow";

export default defineConfig({
  schema: path.join(repoRoot, "prisma/schema.prisma"),
  migrations: {
    path: path.join(repoRoot, "prisma/migrations"),
  },
  datasource: {
    url: databaseUrl,
  },
});
