import crypto from "node:crypto";

function scryptAsync(
  password: string,
  salt: Buffer,
  keylen: number,
  options: crypto.ScryptOptions,
) {
  return new Promise<Buffer>((resolve, reject) => {
    crypto.scrypt(password, salt, keylen, options, (err, derived) => {
      if (err) reject(err);
      else resolve(derived);
    });
  });
}

/** Store as `scrypt$N$r$p$saltHash$derived` (hex). */
export async function hashPassword(password: string) {
  const N = 16384;
  const r = 8;
  const p = 1;
  const salt = crypto.randomBytes(16);
  const derived = await scryptAsync(password, salt, 64, { N, r, p });
  return `scrypt$${N}$${r}$${p}$${salt.toString("hex")}$${derived.toString("hex")}`;
}

export async function verifyPassword(password: string, encoded: string) {
  const parts = encoded.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;
  const N = Number(parts[1]);
  const r = Number(parts[2]);
  const p = Number(parts[3]);
  const salt = Buffer.from(parts[4], "hex");
  const expected = Buffer.from(parts[5], "hex");
  if (!N || !r || !p || !salt.length || !expected.length) return false;
  const derived = await scryptAsync(password, salt, expected.length, {
    N,
    r,
    p,
  });
  return crypto.timingSafeEqual(derived, expected);
}

export function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

export function isValidEmail(email: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}
