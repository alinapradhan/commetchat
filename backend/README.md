# CometChat backend

A small Node.js API for the React app in [`../frontend`](../frontend). It handles email/password accounts and gives each
signed-in user their own CometChat login token, so the CometChat REST API key never reaches the browser.

It uses only Node's built-in modules (HTTP server, `node:sqlite`, `crypto`): there are no npm packages to install
or audit.

## Requirements

Node.js 22.13 or newer (for the built-in SQLite). Accounts live in one SQLite file, `data/app.db`, created on first run.

## Running it

```sh
cp .env.example .env     # then fill in the values below
npm run dev              # API on http://127.0.0.1:4000, restarts when files change
```

| Command | Use with the frontend's | Chat tokens |
|---|---|---|
| `npm run dev` | `npm run dev` | Real CometChat (needs the keys below) |
| `npm run dev:demo` | `npm run demo:auth` | Fake tokens for the offline demo chat, no keys needed |
| `npm start` | production | Real CometChat |

For real CometChat, set `COMETCHAT_APP_ID`, `COMETCHAT_REGION` and `COMETCHAT_REST_API_KEY` in `.env`
(CometChat dashboard -> API & Auth Keys -> REST API key). With no key set, the server runs in demo mode.

## API

| Route | What it does |
|---|---|
| `POST /api/auth/signup` | Create an account and start a session |
| `POST /api/auth/login` | Start a session |
| `POST /api/auth/logout` | End the session and revoke the CometChat token |
| `GET /api/auth/me` | The signed-in account, or 401 |
| `POST /api/chat/token` | A CometChat auth token for the signed-in user |
| `GET /api/health` | `{ ok: true, chat: "demo" \| "live" }` |

## How sign-in works

```
browser                         this server                          CometChat
  | -- POST /api/auth/login --->  | check scrypt password hash
  | <-- HttpOnly session cookie - |
  | -- POST /api/chat/token ----> | -- POST /users/{uid}/auth_tokens -> |   (secret REST key)
  | <-- { authToken } ----------- | <-------------------------------- |
  | -- CometChat.login(authToken) -------------------------------------> |
```

The session cookie is `SameSite=Strict`, so the frontend must reach this API on its **own origin**: through
Vite's `/api` proxy in development and a reverse proxy in production. There is deliberately no CORS.

## Security

| Area | What the server does |
|---|---|
| Passwords | scrypt hashes with a random salt (never stored in plain text); 8 to 128 characters; common passwords rejected |
| Sessions | Random 256-bit tokens; only a SHA-256 of each is stored; 7-day expiry that slides with use; at most 10 per user; ended on logout |
| Cookies | `HttpOnly` (page JavaScript can't read them), `SameSite=Strict`, `Secure` and the `__Host-` prefix in production |
| CSRF | SameSite cookies plus an `Origin` check on every state-changing request; JSON-only bodies |
| Brute force | Account locks for 15 minutes after 5 wrong passwords; per-address and per-email rate limits |
| Enumeration | Same message and similar timing for "wrong password" and "no such account" |
| Input | Validated and length-limited; parameterised SQL only; 10 KB request body limit; slow requests time out |
| Responses | `no-store`, `nosniff`, `DENY` framing and a strict Content-Security-Policy; errors never include internals |
| Secrets | The CometChat REST key lives only in `.env` (git-ignored); the server refuses to start in production without it |

## Deploying

1. In `.env` set `NODE_ENV=production`, `ALLOWED_ORIGINS=https://your-domain`, a `DB_PATH` outside the project
   folder, and keep `HOST=127.0.0.1` behind a reverse proxy. Add `TRUST_PROXY=true` only if the proxy sets
   `X-Forwarded-For`.
2. Serve the frontend on the same domain: either the reverse proxy serves its `dist/` and forwards `/api/` here,
   or set `SERVE_FRONTEND=true` and `FRONTEND_DIR=<path to the frontend's dist>` so this server serves it.
3. Run `npm start` behind HTTPS (for example nginx or Caddy). Production cookies are `Secure`, so HTTPS is required.
4. Back up the SQLite file regularly. It holds account emails and password hashes, so keep it private.

The rate limits are kept in memory, so they assume one server process. Running several instances behind a load
balancer would need a shared store (for example Redis).

## Tests

```sh
npm test
```
