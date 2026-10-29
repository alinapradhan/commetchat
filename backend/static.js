import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import path from "node:path";

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
};

// The page may only load its own scripts and talk to this server and CometChat.
const PAGE_CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "media-src 'self' data: blob: https:",
  "font-src 'self' data:",
  "connect-src 'self' https://*.cometchat.io wss://*.cometchat.io",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

// Serves the built React app (dist/) in production, with an SPA fallback to index.html.
export function createStaticHandler(rootDir, config) {
  const root = path.resolve(rootDir);

  return async function serveStatic(req, res, pathname) {
    if (req.method !== "GET" && req.method !== "HEAD") return false;
    let decoded;
    try {
      decoded = decodeURIComponent(pathname);
    } catch {
      return false;
    }
    let file = path.resolve(root, `.${decoded}`);
    if (file !== root && !file.startsWith(root + path.sep)) return false; // blocks ../ path traversal

    let info = await stat(file).catch(() => null);
    if (!info?.isFile()) {
      if (path.extname(decoded)) return false; // a missing file is a 404, not the app page
      file = path.join(root, "index.html");
      info = await stat(file).catch(() => null);
      if (!info) return false;
    }

    const isAsset = file.startsWith(path.join(root, "assets") + path.sep);
    res.writeHead(200, {
      "Content-Type": TYPES[path.extname(file)] ?? "application/octet-stream",
      "Content-Length": info.size,
      "Cache-Control": isAsset ? "public, max-age=31536000, immutable" : "no-cache",
      "Content-Security-Policy": PAGE_CSP,
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "strict-origin-when-cross-origin",
      "X-Frame-Options": "DENY",
      "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
      ...(config.cookieSecure && { "Strict-Transport-Security": "max-age=31536000; includeSubDomains" }),
    });
    if (req.method === "HEAD") res.end();
    else createReadStream(file).pipe(res);
    return true;
  };
}
