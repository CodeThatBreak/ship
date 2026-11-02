import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  serverExternalPackages: ["better-sqlite3", "@cursor/sdk"],
  outputFileTracingRoot: __dirname,
  env: {
    DEVFLOW_LOCAL_API_TOKEN: process.env.DEVFLOW_LOCAL_API_TOKEN ?? "",
  },
};

export default nextConfig;
