import crypto from "node:crypto";

import { getConfig } from "@/lib/config";

export function sha256(input: string) {
  return crypto.createHash("sha256").update(input).digest();
}

export function randomId(prefix: string) {
  return `${prefix}_${crypto.randomUUID().replace(/-/g, "")}`;
}

/** AES-256-GCM; returns base64url(iv || tag || ciphertext). */
export function encryptSecret(plaintext: string, purpose: string, ownerUserId: string) {
  const key = sha256(`${getConfig().vaultMasterKey}:${purpose}:${ownerUserId}`);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, encrypted]).toString("base64url");
}

export function decryptSecret(
  payload: string,
  purpose: string,
  ownerUserId: string,
) {
  const key = sha256(`${getConfig().vaultMasterKey}:${purpose}:${ownerUserId}`);
  const raw = Buffer.from(payload, "base64url");
  const iv = raw.subarray(0, 12);
  const tag = raw.subarray(12, 28);
  const encrypted = raw.subarray(28);
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([
    decipher.update(encrypted),
    decipher.final(),
  ]).toString("utf8");
}

export function encryptToken(token: string) {
  return encryptSecret(token, "slack-install", "platform");
}

export function decryptToken(payload: string) {
  return decryptSecret(payload, "slack-install", "platform");
}
