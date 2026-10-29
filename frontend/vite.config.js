import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ mode }) => {
  // The API is a separate app (../backend). Proxying /api keeps it
  // same-origin, so the backend's SameSite=Strict session cookie works.
  const apiTarget = loadEnv(mode, process.cwd(), "").API_PROXY_TARGET || "http://127.0.0.1:4000";
  const proxy = { "/api": apiTarget };

  return {
    plugins: [react()],
    server: { proxy },
    preview: { proxy },
    test: {
      include: ["src/**/*.test.js"],
    },
  };
});
