// Small HTTP helpers for the zero-dependency server.

export class HttpError extends Error {
  constructor(status, message, headers = {}) {
    super(message);
    this.status = status;
    this.headers = headers;
  }
}

// Headers for every API response: no caching, no sniffing, no framing, no embedding.
export const API_HEADERS = {
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "X-Frame-Options": "DENY",
  "Cross-Origin-Resource-Policy": "same-origin",
  "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'",
};

export const BODY_LIMIT_BYTES = 10 * 1024;

export async function readJson(req, limit = BODY_LIMIT_BYTES) {
  const type = (req.headers["content-type"] || "").toLowerCase();
  if (!type.startsWith("application/json")) throw new HttpError(415, "Content-Type must be application/json.");
  const declared = Number(req.headers["content-length"] || 0);
  if (declared > limit) throw new HttpError(413, "Request body is too large.");

  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw new HttpError(413, "Request body is too large.");
    chunks.push(chunk);
  }
  if (!size) return {};
  try {
    const value = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error();
    return value;
  } catch {
    throw new HttpError(400, "Request body must be a JSON object.");
  }
}

export function parseCookies(header = "") {
  const cookies = {};
  for (const part of header.split(";")) {
    const index = part.indexOf("=");
    if (index < 1) continue;
    const name = part.slice(0, index).trim();
    if (!(name in cookies)) cookies[name] = part.slice(index + 1).trim();
  }
  return cookies;
}

export function serializeCookie(name, value, { maxAgeSeconds, secure }) {
  return [
    `${name}=${value}`,
    "Path=/",
    "HttpOnly", // JavaScript can't read it, so XSS can't steal the session
    "SameSite=Strict", // never sent on cross-site requests
    `Max-Age=${maxAgeSeconds}`,
    secure && "Secure",
  ]
    .filter(Boolean)
    .join("; ");
}

export function sendJson(res, status, body, headers = {}) {
  res.writeHead(status, { ...API_HEADERS, "Content-Type": "application/json; charset=utf-8", ...headers });
  res.end(body === undefined ? undefined : JSON.stringify(body));
}
