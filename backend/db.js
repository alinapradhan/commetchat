import { chmodSync, existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

// SQLite file database: free, no separate server, one file to back up.
export function openDb(file) {
  if (file !== ":memory:") mkdirSync(path.dirname(file), { recursive: true });
  const isNew = file !== ":memory:" && !existsSync(file);
  const db = new DatabaseSync(file);

  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;
    PRAGMA busy_timeout = 5000;

    CREATE TABLE IF NOT EXISTS users (
      id             INTEGER PRIMARY KEY,
      uid            TEXT    NOT NULL UNIQUE,          -- CometChat user id
      email          TEXT    NOT NULL UNIQUE COLLATE NOCASE,
      name           TEXT    NOT NULL,
      password_hash  TEXT    NOT NULL,                 -- scrypt, never the password
      failed_logins  INTEGER NOT NULL DEFAULT 0,
      locked_until   INTEGER NOT NULL DEFAULT 0,
      created_at     INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id_hash          TEXT    PRIMARY KEY,            -- SHA-256 of the cookie value
      user_id          INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      cometchat_token  TEXT,                           -- revoked on logout
      created_at       INTEGER NOT NULL,
      expires_at       INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS sessions_user ON sessions(user_id);
    CREATE INDEX IF NOT EXISTS sessions_expiry ON sessions(expires_at);
  `);

  // Owner-only access to the database file (no effect on Windows).
  if (isNew && process.platform !== "win32") chmodSync(file, 0o600);
  return db;
}
