import { createHash, randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(scryptCallback);

// ---------------------------------------------------------------- passwords
// scrypt is memory-hard, which makes stolen hashes expensive to crack.
const SCRYPT = { N: 2 ** 15, r: 8, p: 1 };
const MAXMEM = 64 * 1024 * 1024;
const KEY_LENGTH = 64;

export async function hashPassword(password) {
  const salt = randomBytes(16);
  const hash = await scrypt(password.normalize("NFKC"), salt, KEY_LENGTH, { ...SCRYPT, maxmem: MAXMEM });
  return ["scrypt", SCRYPT.N, SCRYPT.r, SCRYPT.p, salt.toString("base64"), hash.toString("base64")].join("$");
}

export async function verifyPassword(password, stored) {
  const [algorithm, N, r, p, salt, hash] = String(stored).split("$");
  if (algorithm !== "scrypt" || !salt || !hash) return false;
  const expected = Buffer.from(hash, "base64");
  const actual = await scrypt(password.normalize("NFKC"), Buffer.from(salt, "base64"), expected.length, {
    N: Number(N),
    r: Number(r),
    p: Number(p),
    maxmem: MAXMEM,
  });
  return timingSafeEqual(actual, expected);
}

// Spends the same time as a real check, so unknown emails can't be detected by timing.
let decoyHash = null;
export async function decoyPasswordCheck(password) {
  decoyHash ??= await hashPassword(randomBytes(16).toString("hex"));
  await verifyPassword(password, decoyHash);
}

// ---------------------------------------------------------------- tokens
export const newToken = () => randomBytes(32).toString("base64url");
export const sha256 = (value) => createHash("sha256").update(value).digest("hex");
export const newUid = () => `u${randomBytes(10).toString("hex")}`;

// ---------------------------------------------------------------- validation- demo passsword 

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/g;
const COMMON_PASSWORDS = new Set([
  "password", "password1", "password123", "passw0rd", "12345678", "123456789", "1234567890", "11111111",
  "00000000", "87654321", "qwerty123", "qwertyuiop", "iloveyou", "abc12345", "abcd1234", "letmein1",
  "welcome1", "welcome123", "admin123", "1q2w3e4r", "sunshine", "football", "baseball", "princess",
  "monkey123", "dragon12", "trustno1", "superman", "changeme",
]);

export const PASSWORD_MIN = 8;
export const PASSWORD_MAX = 128;

export function cleanEmail(value) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

export function validateSignup(body) {
  const name = typeof body.name === "string" ? body.name.replace(CONTROL_CHARS, "").trim() : "";
  const email = cleanEmail(body.email);
  const password = typeof body.password === "string" ? body.password : "";

  if (!name || name.length > 60) return { error: "Enter a name of 1 to 60 characters." };
  if (email.length > 254 || !EMAIL_PATTERN.test(email)) return { error: "Enter a valid email address." };
  const passwordError = checkPassword(password, email);
  if (passwordError) return { error: passwordError };
  return { value: { name, email, password } };
}

export function checkPassword(password, email = "") {
  if (password.length < PASSWORD_MIN || password.length > PASSWORD_MAX) {
    return `Use a password of ${PASSWORD_MIN} to ${PASSWORD_MAX} characters.`;
  }
  const lower = password.toLowerCase();
  if (COMMON_PASSWORDS.has(lower) || /^(.)\1+$/.test(password)) return "That password is too easy to guess.";
  const localPart = email.split("@")[0];
  if (localPart.length >= 4 && lower.includes(localPart)) return "Don't use your email address in your password.";
  return null;
}

// ---------------------------------------------------------------- rate limiting
// Fixed-window counter kept in memory. Fine for one server process.
export function createRateLimiter({ windowMs, max }) {
  const hits = new Map();
  return {
    hit(key) {
      const now = Date.now();
      const entry = hits.get(key);
      if (!entry || entry.resetAt <= now) {
        hits.set(key, { count: 1, resetAt: now + windowMs });
        return { ok: true };
      }
      entry.count += 1;
      return entry.count > max ? { ok: false, retryAfter: Math.ceil((entry.resetAt - now) / 1000) } : { ok: true };
    },
    reset(key) {
      hits.delete(key);
    },
    sweep() {
      const now = Date.now();
      for (const [key, entry] of hits) if (entry.resetAt <= now) hits.delete(key);
    },
  };
}
