import assert from "node:assert/strict";
import { createServer } from "node:http";
import { after, before, describe, it } from "node:test";
import { createApp } from "../app.js";
import { createCometChatClient } from "../cometchat.js";
import { loadConfig } from "../config.js";
import { openDb } from "../db.js";

const ORIGIN = "http://localhost:5173";
let server, base, db, app;

before(async () => {
  const config = { ...loadConfig({ COMETCHAT_MODE: "demo" }), dbPath: ":memory:" };
  db = openDb(":memory:");
  // Every test call comes from 127.0.0.1, so raise the per-address ceilings.
  // The per-email login limit keeps its real value and is tested below.
  app = createApp(config, {
    db,
    cometchat: createCometChatClient(config.cometchat),
    log: { error() {} },
    rateLimits: { ip: 1000, signup: 1000 },
  });
  server = createServer(app.handle);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => {
  app.close();
  server.close();
  db.close();
});

let counter = 0;
const uniqueEmail = () => `user${++counter}-${Date.now()}@example.com`;
const STRONG = "correct horse battery";

function request(path, { method = "GET", body, cookie, origin = ORIGIN, headers = {} } = {}) {
  return fetch(base + path, {
    method,
    headers: {
      ...(body !== undefined && { "content-type": "application/json" }),
      ...(origin && { origin }),
      ...(cookie && { cookie }),
      ...headers,
    },
    body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
  });
}

const cookieOf = (res) => res.headers.get("set-cookie")?.split(";")[0];

async function signup(email = uniqueEmail(), password = STRONG) {
  const res = await request("/api/auth/signup", { method: "POST", body: { name: "Test User", email, password } });
  return { res, email, cookie: cookieOf(res) };
}

describe("signup", () => {
  it("creates an account, hides the password and sets a locked-down session cookie", async () => {
    const { res, email } = await signup();
    assert.equal(res.status, 201);
    const { user } = await res.json();
    assert.equal(user.email, email);
    assert.match(user.uid, /^u[0-9a-f]{20}$/);
    assert.equal(user.password_hash, undefined);

    const cookie = res.headers.get("set-cookie");
    assert.match(cookie, /HttpOnly/);
    assert.match(cookie, /SameSite=Strict/);
    assert.match(cookie, /Path=\//);
  });

  it("stores only an scrypt hash, never the password", async () => {
    const { email } = await signup();
    const row = db.prepare("SELECT password_hash FROM users WHERE email = ?").get(email);
    assert.match(row.password_hash, /^scrypt\$/);
    assert.ok(!row.password_hash.includes(STRONG));
  });

  it("stores only a hash of the session token", async () => {
    const { cookie } = await signup();
    const token = cookie.split("=")[1];
    const found = db.prepare("SELECT COUNT(*) AS n FROM sessions WHERE id_hash = ?").get(token);
    assert.equal(found.n, 0);
  });

  it("rejects weak passwords, bad emails and bad names", async () => {
    for (const body of [
      { name: "A", email: uniqueEmail(), password: "short" },
      { name: "A", email: uniqueEmail(), password: "password123" },
      { name: "A", email: uniqueEmail(), password: "aaaaaaaaaaaa" },
      { name: "A", email: "not-an-email", password: STRONG },
      { name: "A", email: "' OR 1=1 --", password: STRONG },
      { name: "", email: uniqueEmail(), password: STRONG },
      { name: "x".repeat(61), email: uniqueEmail(), password: STRONG },
    ]) {
      const res = await request("/api/auth/signup", { method: "POST", body });
      assert.equal(res.status, 400, JSON.stringify(body));
    }
  });

  it("refuses a duplicate email, whatever the letter case", async () => {
    const { email } = await signup();
    const { res } = await signup(email.toUpperCase());
    assert.equal(res.status, 409);
  });
});

describe("login and sessions", () => {
  it("logs in, reads the session, and logout ends it on the server", async () => {
    const { email } = await signup();
    const login = await request("/api/auth/login", { method: "POST", body: { email, password: STRONG } });
    assert.equal(login.status, 200);
    const cookie = cookieOf(login);

    const me = await request("/api/auth/me", { cookie });
    assert.equal(me.status, 200);
    assert.equal((await me.json()).user.email, email);

    const out = await request("/api/auth/logout", { method: "POST", cookie });
    assert.equal(out.status, 204);
    assert.match(out.headers.get("set-cookie"), /Max-Age=0/);

    const again = await request("/api/auth/me", { cookie });
    assert.equal(again.status, 401, "old cookie must stop working after logout");
  });

  it("gives the same answer for a wrong password and an unknown email", async () => {
    const { email } = await signup();
    const wrong = await request("/api/auth/login", { method: "POST", body: { email, password: "wrong password 1" } });
    const unknown = await request("/api/auth/login", {
      method: "POST",
      body: { email: uniqueEmail(), password: "wrong password 1" },
    });
    assert.equal(wrong.status, 401);
    assert.equal(unknown.status, 401);
    assert.deepEqual(await wrong.json(), await unknown.json());
  });

  it("locks the account after 5 failed attempts, even for the right password", async () => {
    const { email } = await signup();
    for (let i = 0; i < 5; i++) {
      const res = await request("/api/auth/login", { method: "POST", body: { email, password: `nope-${i}-abcdef` } });
      assert.equal(res.status, 401);
    }
    const locked = await request("/api/auth/login", { method: "POST", body: { email, password: STRONG } });
    assert.equal(locked.status, 429);
  });

  it("rejects forged or missing session cookies", async () => {
    assert.equal((await request("/api/auth/me")).status, 401);
    assert.equal((await request("/api/auth/me", { cookie: "sid=forged-token" })).status, 401);
  });
});

describe("chat token", () => {
  it("requires a session", async () => {
    const res = await request("/api/chat/token", { method: "POST" });
    assert.equal(res.status, 401);
  });

  it("issues a token for the logged-in user only", async () => {
    const { res, cookie } = await signup();
    const { user } = await res.json();
    const tokenRes = await request("/api/chat/token", { method: "POST", cookie });
    assert.equal(tokenRes.status, 200);
    const body = await tokenRes.json();
    assert.equal(body.uid, user.uid);
    const payload = JSON.parse(Buffer.from(body.authToken.split(".")[1], "base64url").toString());
    assert.equal(payload.uid, user.uid);
  });
});

describe("request hardening", () => {
  it("blocks cross-site requests (CSRF) by Origin", async () => {
    const { cookie } = await signup();
    for (const origin of [null, "https://evil.example"]) {
      const res = await request("/api/chat/token", { method: "POST", cookie, origin });
      assert.equal(res.status, 403, `origin ${origin}`);
    }
  });

  it("only accepts JSON bodies, and only small ones", async () => {
    const form = await request("/api/auth/login", {
      method: "POST",
      body: "email=a&password=b",
      headers: { "content-type": "application/x-www-form-urlencoded" },
    });
    assert.equal(form.status, 415);

    const huge = await request("/api/auth/signup", {
      method: "POST",
      body: { name: "x", email: uniqueEmail(), password: "y".repeat(20_000) },
    });
    assert.equal(huge.status, 413);

    const broken = await request("/api/auth/login", { method: "POST", body: "{not json" });
    assert.equal(broken.status, 400);
  });

  it("sends security headers and never caches API responses", async () => {
    const res = await request("/api/health");
    assert.equal(res.headers.get("x-content-type-options"), "nosniff");
    assert.equal(res.headers.get("x-frame-options"), "DENY");
    assert.equal(res.headers.get("cache-control"), "no-store");
    assert.match(res.headers.get("content-security-policy"), /default-src 'none'/);
  });

  it("rate-limits repeated logins for the same email", async () => {
    const email = uniqueEmail(); // no account: never locks, so only the rate limit can stop it
    const statuses = [];
    for (let i = 0; i < 12; i++) {
      const res = await request("/api/auth/login", { method: "POST", body: { email, password: "whatever-123" } });
      statuses.push(res.status);
    }
    assert.ok(statuses.includes(429), statuses.join(","));
    assert.ok(statuses.slice(0, 10).every((s) => s === 401));
  });

  it("limits signups per address with the default settings", async () => {
    const strict = createApp(
      { ...loadConfig({ COMETCHAT_MODE: "demo" }) },
      { db, cometchat: createCometChatClient({ demo: true }), log: { error() {} } },
    );
    const strictServer = createServer(strict.handle);
    await new Promise((resolve) => strictServer.listen(0, "127.0.0.1", resolve));
    const url = `http://127.0.0.1:${strictServer.address().port}/api/auth/signup`;
    const statuses = [];
    for (let i = 0; i < 11; i++) {
      const res = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json", origin: ORIGIN },
        body: JSON.stringify({ name: "x", email: "bad", password: "x" }),
      });
      statuses.push(res.status);
    }
    strict.close();
    strictServer.close();
    assert.equal(statuses.at(-1), 429, statuses.join(","));
  });

  it("returns 404 for unknown API routes without leaking details", async () => {
    const res = await request("/api/../../etc/passwd");
    assert.equal(res.status, 404);
  });
});
