# CometChat React (frontend)

A 1:1 and group chat app built with React (Vite) and the CometChat JavaScript SDK v4.
Accounts and CometChat login tokens come from the backend in [`../backend`](../backend).

**Features**

- Email/password accounts handled by our own server
- Chats, Users and Groups tabs with search and load-on-scroll
- Real-time text, image and file messages, with clickable links and an emoji picker
- Reply, edit, delete, copy and emoji reactions on any message
- Typing indicators, delivered/read ticks (1:1 and groups) and online presence
- Date separators, a "New messages" divider and a jump-to-latest button
- Create, join and leave groups; view members, add members and remove them (admins)
- Contact details with block/unblock; mute or delete a chat
- Connection banner, optional notifications with sound, loading skeletons, light/dark theme and a mobile layout

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for diagrams and design notes.

## Requirements

Node.js 22.13 or newer. For anything except `npm run demo`, the backend must be running too (default
http://127.0.0.1:4000).

## Ways to run it

| Frontend | Backend | Accounts | Chat | Needs keys? |
|---|---|---|---|---|
| `npm run demo` | not needed | Pick a sample user, no passwords | Offline fake in the browser | No |
| `npm run demo:auth` | `npm run dev:demo` | Real sign up / log in | Offline fake in the browser | No |
| `npm run dev` | `npm run dev` | Real sign up / log in | Real CometChat | Yes |

All three open at http://localhost:5173. Run `npm install` once first.

### `npm run demo` (quickest look)

Open two tabs of the same browser window, log in as `cometchat-uid-1` in one and `cometchat-uid-2` in the other,
and chat between them. Nancy, Susan and John (`uid-3` to `uid-5`) are bots that reply. A recorded walkthrough is in
[docs/demo/](docs/demo/chat-demo.gif).

### `npm run dev` (real CometChat)

1. Create a free app at https://app.cometchat.com.
2. Copy `.env.example` to `.env` and set `VITE_COMETCHAT_APP_ID` and `VITE_COMETCHAT_REGION`.
3. Set up and start the backend (see its README).
4. `npm run dev`.

## How it talks to the backend

The app calls `/api/...` on its own origin. In development, Vite proxies `/api` to the backend
(`API_PROXY_TARGET` in `.env`, default `http://127.0.0.1:4000`). Keeping the API same-origin is what lets the
backend use a `SameSite=Strict`, `HttpOnly` session cookie with no CORS.

## Deploying

1. `npm run build`. The app is written to `dist/`.
2. Serve `dist/` from the same domain as the API, using either option:
   - **Reverse proxy (recommended)**: nginx or Caddy serves `dist/` (with a fallback to `index.html`) and forwards
     `/api/` to the backend.
   - **Backend serves it**: set `SERVE_FRONTEND=true` and `FRONTEND_DIR=<path to dist>` in the backend's `.env`.
3. Add the site's address to the backend's `ALLOWED_ORIGINS`.

## Tests

```sh
npm test
```
