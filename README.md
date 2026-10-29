# CometChat React

A 1:1 and group chat app built on CometChat. The UI and the backend are two separate apps in this repo. Each has
its own `package.json`, `.env`, tests and README, and they are installed, run and deployed independently.

| Folder | What it is | Details |
|---|---|---|
| [`frontend/`](frontend) | React (Vite) app using the CometChat JavaScript SDK v4 | [frontend/README.md](frontend/README.md) |
| [`backend/`](backend) | Node.js API for accounts and CometChat login tokens (no npm dependencies) | [backend/README.md](backend/README.md) |

Requires Node.js 22.13 or newer.

## Quick start

Try the UI on its own with an offline fake chat (no keys, no backend):

```sh
cd frontend
npm install
npm run demo
```

Run the full app with real CometChat in two terminals, after filling in `backend/.env` and `frontend/.env`
from their `.env.example` files:

```sh
# Terminal 1
cd backend
npm run dev        # API on http://127.0.0.1:4000

# Terminal 2
cd frontend
npm install
npm run dev        # UI on http://localhost:5173 (proxies /api to the backend)
```

To try real sign up / log in without CometChat keys, run `npm run dev:demo` in `backend/` and
`npm run demo:auth` in `frontend/`.

## Tests

```sh
cd backend && npm test
cd frontend && npm test
```

See [frontend/docs/ARCHITECTURE.md](frontend/docs/ARCHITECTURE.md) for diagrams and design notes.
