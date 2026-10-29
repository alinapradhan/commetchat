import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

// Reads settings from environment variables (.env is loaded by index.js).
export function loadConfig(env = process.env) {
  const production = env.NODE_ENV === "production";
  const restApiKey = env.COMETCHAT_REST_API_KEY || "";
  // Demo mode issues fake chat tokens for the offline demo backend. Never allowed in production.
  const demo = env.COMETCHAT_MODE === "demo" || !restApiKey;

  if (production && demo) {
    throw new Error("COMETCHAT_REST_API_KEY is required when NODE_ENV=production (demo mode is for local use only).");
  }
  if (!demo && (!env.COMETCHAT_APP_ID || !env.COMETCHAT_REGION)) {
    throw new Error("COMETCHAT_APP_ID and COMETCHAT_REGION are required when COMETCHAT_REST_API_KEY is set.");
  }

  return {
    production,
    host: env.HOST || "127.0.0.1",
    port: Number(env.PORT || 4000),
    dbPath: env.DB_PATH || path.join(here, "data", "app.db"),
    allowedOrigins: (env.ALLOWED_ORIGINS || "http://localhost:5173")
      .split(",")
      .map((origin) => origin.trim())
      .filter(Boolean),
    cookieSecure: env.COOKIE_SECURE ? env.COOKIE_SECURE === "true" : production,
    sessionTtlMs: Number(env.SESSION_TTL_DAYS || 7) * 24 * 60 * 60 * 1000,
    trustProxy: env.TRUST_PROXY === "true",
    serveFrontend: env.SERVE_FRONTEND === "true",
    // The frontend's build output (../frontend/dist), used only when SERVE_FRONTEND=true.
    frontendDir: path.resolve(here, env.FRONTEND_DIR || path.join("..", "frontend", "dist")),
    cometchat: {
      demo,
      appId: env.COMETCHAT_APP_ID || "",
      region: env.COMETCHAT_REGION || "",
      restApiKey,
    },
  };
}
