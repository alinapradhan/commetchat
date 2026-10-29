import { HttpError, parseCookies, readJson, sendJson, serializeCookie } from "./http.js";
import {
  PASSWORD_MAX,
  cleanEmail,
  createRateLimiter,
  decoyPasswordCheck,
  hashPassword,
  newToken,
  newUid,
  sha256,
  validateSignup,
  verifyPassword,
} from "./security.js";
import { createStaticHandler } from "./static.js";

const MINUTE = 60 * 1000;
const LOCK_AFTER_FAILURES = 5;
const LOCK_DURATION_MS = 15 * MINUTE;
const MAX_SESSIONS_PER_USER = 10;
const INVALID_LOGIN = "Incorrect email or password.";
const TOO_MANY = "Too many attempts. Please wait a few minutes and try again.";

const publicUser = (row) => ({ uid: row.uid, name: row.name, email: row.email });

export const DEFAULT_RATE_LIMITS = {
  ip: 100, // auth calls per address per 15 minutes
  login: 10, // login attempts per address + email per 15 minutes
  signup: 10, // signups per address per hour
  token: 30, // chat tokens per user per minute
};

export function createApp(config, { db, cometchat, now = () => Date.now(), log = console, rateLimits = {} }) {
  const cookieName = config.cookieSecure ? "__Host-sid" : "sid";
  const max = { ...DEFAULT_RATE_LIMITS, ...rateLimits };
  const limits = {
    ip: createRateLimiter({ windowMs: 15 * MINUTE, max: max.ip }),
    login: createRateLimiter({ windowMs: 15 * MINUTE, max: max.login }),
    signup: createRateLimiter({ windowMs: 60 * MINUTE, max: max.signup }),
    token: createRateLimiter({ windowMs: MINUTE, max: max.token }),
  };
  const serveStatic = config.serveFrontend ? createStaticHandler(config.frontendDir, config) : null;

  const sql = {
    userByEmail: db.prepare("SELECT * FROM users WHERE email = ?"),
    insertUser: db.prepare(
      "INSERT INTO users (uid, email, name, password_hash, created_at) VALUES (?, ?, ?, ?, ?) RETURNING *",
    ),
    deleteUser: db.prepare("DELETE FROM users WHERE id = ?"),
    recordFailure: db.prepare(
      `UPDATE users SET
         failed_logins = CASE WHEN failed_logins + 1 >= ? THEN 0 ELSE failed_logins + 1 END,
         locked_until  = CASE WHEN failed_logins + 1 >= ? THEN ? ELSE locked_until END
       WHERE id = ?`,
    ),
    clearFailures: db.prepare("UPDATE users SET failed_logins = 0, locked_until = 0 WHERE id = ?"),
    insertSession: db.prepare("INSERT INTO sessions (id_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)"),
    sessionUser: db.prepare(
      `SELECT s.id_hash, s.expires_at, s.cometchat_token, u.*
         FROM sessions s JOIN users u ON u.id = s.user_id
        WHERE s.id_hash = ? AND s.expires_at > ?`,
    ),
    extendSession: db.prepare("UPDATE sessions SET expires_at = ? WHERE id_hash = ?"),
    setSessionToken: db.prepare("UPDATE sessions SET cometchat_token = ? WHERE id_hash = ?"),
    deleteSession: db.prepare("DELETE FROM sessions WHERE id_hash = ?"),
    trimSessions: db.prepare(
      `DELETE FROM sessions WHERE user_id = ? AND id_hash NOT IN
         (SELECT id_hash FROM sessions WHERE user_id = ? ORDER BY created_at DESC LIMIT ?)`,
    ),
    deleteExpired: db.prepare("DELETE FROM sessions WHERE expires_at <= ?"),
  };

  const sweeper = setInterval(() => {
    sql.deleteExpired.run(now());
    Object.values(limits).forEach((limit) => limit.sweep());
  }, 5 * MINUTE);
  sweeper.unref();

  // ---------------------------------------------------------------- helpers

  const clientIp = (req) =>
    (config.trustProxy && req.headers["x-forwarded-for"]?.split(",")[0].trim()) || req.socket.remoteAddress || "?";

  function limit(limiter, key) {
    const result = limiter.hit(key);
    if (!result.ok) throw new HttpError(429, TOO_MANY, { "Retry-After": String(result.retryAfter) });
  }

  // CSRF defence on top of SameSite=Strict: state-changing calls must come from our own pages.
  function requireAllowedOrigin(req) {
    const origin = req.headers.origin;
    if (!origin || !config.allowedOrigins.includes(origin)) throw new HttpError(403, "Request origin not allowed.");
  }

  function sessionCookie(token, maxAgeMs) {
    return serializeCookie(cookieName, token, {
      maxAgeSeconds: Math.floor(maxAgeMs / 1000),
      secure: config.cookieSecure,
    });
  }

  function startSession(userId) {
    const token = newToken();
    const created = now();
    sql.insertSession.run(sha256(token), userId, created, created + config.sessionTtlMs);
    sql.trimSessions.run(userId, userId, MAX_SESSIONS_PER_USER);
    return sessionCookie(token, config.sessionTtlMs);
  }

  // Returns { row, cookie } for a valid session; slides the expiry forward when it is half used.
  function readSession(req) {
    const token = parseCookies(req.headers.cookie)[cookieName];
    if (!token || token.length > 128) return null;
    const row = sql.sessionUser.get(sha256(token), now());
    if (!row) return null;
    let cookie;
    if (row.expires_at - now() < config.sessionTtlMs / 2) {
      sql.extendSession.run(now() + config.sessionTtlMs, row.id_hash);
      cookie = sessionCookie(token, config.sessionTtlMs);
    }
    return { row, cookie };
  }

  function requireSession(req) {
    const session = readSession(req);
    if (!session) throw new HttpError(401, "Please log in.");
    return session;
  }

  // ---------------------------------------------------------------- routes

  async function signup(req, res) {
    requireAllowedOrigin(req);
    const ip = clientIp(req);
    limit(limits.ip, ip);
    limit(limits.signup, ip);
    const { value, error } = validateSignup(await readJson(req));
    if (error) throw new HttpError(400, error);
    if (sql.userByEmail.get(value.email)) throw new HttpError(409, "An account with this email already exists.");

    const passwordHash = await hashPassword(value.password);
    let user;
    try {
      user = sql.insertUser.get(newUid(), value.email, value.name, passwordHash, now());
    } catch {
      throw new HttpError(409, "An account with this email already exists."); // lost a race on the same email
    }
    try {
      await cometchat.createUser(user);
    } catch (e) {
      sql.deleteUser.run(user.id);
      log.error("CometChat user creation failed:", e.message);
      throw new HttpError(502, "The chat service is unavailable. Please try again.");
    }
    sendJson(res, 201, { user: publicUser(user) }, { "Set-Cookie": startSession(user.id) });
  }

  async function login(req, res) {
    requireAllowedOrigin(req);
    const ip = clientIp(req);
    limit(limits.ip, ip);
    const body = await readJson(req);
    const email = cleanEmail(body.email);
    const password = typeof body.password === "string" ? body.password : "";
    if (!email || !password || email.length > 254 || password.length > PASSWORD_MAX) {
      throw new HttpError(401, INVALID_LOGIN);
    }
    limit(limits.login, `${ip}|${email}`);

    const user = sql.userByEmail.get(email);
    if (!user) {
      await decoyPasswordCheck(password);
      throw new HttpError(401, INVALID_LOGIN);
    }
    if (user.locked_until > now()) {
      await decoyPasswordCheck(password);
      throw new HttpError(429, TOO_MANY);
    }
    if (!(await verifyPassword(password, user.password_hash))) {
      sql.recordFailure.run(LOCK_AFTER_FAILURES, LOCK_AFTER_FAILURES, now() + LOCK_DURATION_MS, user.id);
      throw new HttpError(401, INVALID_LOGIN);
    }

    sql.clearFailures.run(user.id);
    limits.login.reset(`${ip}|${email}`);
    sendJson(res, 200, { user: publicUser(user) }, { "Set-Cookie": startSession(user.id) });
  }

  async function logout(req, res) {
    requireAllowedOrigin(req);
    const session = readSession(req);
    if (session) {
      sql.deleteSession.run(session.row.id_hash);
      if (session.row.cometchat_token) await cometchat.revokeAuthToken(session.row.uid, session.row.cometchat_token);
    }
    sendJson(res, 204, undefined, { "Set-Cookie": sessionCookie("", 0) });
  }

  function me(req, res) {
    const { row, cookie } = requireSession(req);
    sendJson(res, 200, { user: publicUser(row) }, cookie ? { "Set-Cookie": cookie } : {});
  }

  // Exchanges the login session for a CometChat auth token used by the SDK in the browser.
  async function chatToken(req, res) {
    requireAllowedOrigin(req);
    const { row } = requireSession(req);
    limit(limits.token, row.uid);
    let authToken;
    try {
      authToken = await cometchat.createAuthToken(row);
    } catch (e) {
      log.error("CometChat token creation failed:", e.message);
      throw new HttpError(502, "The chat service is unavailable. Please try again.");
    }
    if (row.cometchat_token && row.cometchat_token !== authToken) {
      await cometchat.revokeAuthToken(row.uid, row.cometchat_token);
    }
    sql.setSessionToken.run(authToken, row.id_hash);
    sendJson(res, 200, { uid: row.uid, authToken });
  }

  function health(req, res) {
    sendJson(res, 200, { ok: true, chat: cometchat.mode });
  }

  const routes = {
    "POST /api/auth/signup": signup,
    "POST /api/auth/login": login,
    "POST /api/auth/logout": logout,
    "GET /api/auth/me": me,
    "POST /api/chat/token": chatToken,
    "GET /api/health": health,
  };

  async function handle(req, res) {
    let pathname;
    try {
      pathname = new URL(req.url, "http://localhost").pathname;
    } catch {
      return sendJson(res, 400, { error: "Bad request." });
    }

    if (!pathname.startsWith("/api/")) {
      if (serveStatic && (await serveStatic(req, res, pathname))) return;
      return sendJson(res, 404, { error: "Not found." });
    }

    const route = routes[`${req.method} ${pathname}`];
    try {
      if (!route) {
        const otherMethod = routes[`GET ${pathname}`] || routes[`POST ${pathname}`];
        throw otherMethod ? new HttpError(405, "Method not allowed.") : new HttpError(404, "Not found.");
      }
      await route(req, res);
    } catch (error) {
      if (res.headersSent) return res.destroy();
      if (error instanceof HttpError) {
        const headers = error.status === 413 ? { ...error.headers, Connection: "close" } : error.headers;
        return sendJson(res, error.status, { error: error.message }, headers);
      }
      log.error("Unhandled error:", error); // details stay in the server log, never in the response
      sendJson(res, 500, { error: "Something went wrong." });
    }
  }

  return { handle, close: () => clearInterval(sweeper) };
}
