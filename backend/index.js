import { existsSync } from "node:fs";
import { createServer } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createApp } from "./app.js";
import { createCometChatClient } from "./cometchat.js";
import { loadConfig } from "./config.js";
import { openDb } from "./db.js";

const envFile = path.join(path.dirname(fileURLToPath(import.meta.url)), ".env");
if (existsSync(envFile)) process.loadEnvFile(envFile);
// `npm run dev:demo` forces demo chat tokens, for the frontend's `npm run demo:auth`.
if (process.argv.includes("--demo")) process.env.COMETCHAT_MODE = "demo";

const config = loadConfig();
const db = openDb(config.dbPath);
const cometchat = createCometChatClient(config.cometchat);
const app = createApp(config, { db, cometchat });

const server = createServer(app.handle);
server.requestTimeout = 15_000; // drop slow or stalled requests
server.headersTimeout = 10_000;

server.listen(config.port, config.host, () => {
  console.log(`API listening on http://${config.host}:${config.port}`);
  if (config.cometchat.demo) {
    console.warn("Chat mode: DEMO. Tokens only work with the frontend's `npm run demo:auth`. Set COMETCHAT_REST_API_KEY for real CometChat.");
  }
});

function shutdown() {
  server.close(() => {
    app.close();
    db.close();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 5000).unref();
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
