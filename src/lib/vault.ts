import { SignJWT, jwtVerify } from "jose";

import { getConfig } from "@/lib/config";
import { decryptSecret, encryptSecret, randomId } from "@/lib/crypto";
import { appendAudit } from "@/lib/users";
import { getStore, updateStore } from "@/lib/store";
import type { VaultItem } from "@/lib/types";

const VAULT_PURPOSE = "user-vault";

export async function listVaultItems(ownerUserId: string) {
  const store = await getStore();
  return (store.vaultItems[ownerUserId] ?? [])
    .filter((v) => v.ownerUserId === ownerUserId)
    .map(({ ciphertext: _c, ...rest }) => rest)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

function normalizeOrigin(origin?: string) {
  const raw = origin?.trim();
  if (!raw) return undefined;
  try {
    const url = new URL(raw.includes("://") ? raw : `https://${raw}`);
    return `${url.protocol}//${url.host}`;
  } catch {
    return undefined;
  }
}

export async function createVaultItem(input: {
  ownerUserId: string;
  label: string;
  username?: string;
  origin?: string;
  secret: string;
}) {
  const now = new Date().toISOString();
  const item: VaultItem = {
    id: randomId("vault"),
    ownerUserId: input.ownerUserId,
    label: input.label.trim(),
    username: input.username?.trim() || undefined,
    origin: normalizeOrigin(input.origin),
    ciphertext: encryptSecret(input.secret, VAULT_PURPOSE, input.ownerUserId),
    createdAt: now,
    updatedAt: now,
  };
  await updateStore((store) => {
    const list = store.vaultItems[input.ownerUserId] ?? [];
    list.unshift(item);
    store.vaultItems[input.ownerUserId] = list;
  });
  await appendAudit({
    ownerUserId: input.ownerUserId,
    type: "vault.create",
    detail: `Created vault item ${item.label}`,
  });
  const { ciphertext: _c, ...safe } = item;
  return safe;
}

export async function deleteVaultItem(ownerUserId: string, id: string) {
  const ok = await updateStore((store) => {
    const list = store.vaultItems[ownerUserId] ?? [];
    const next = list.filter(
      (v) => !(v.id === id && v.ownerUserId === ownerUserId),
    );
    store.vaultItems[ownerUserId] = next;
    return next.length !== list.length;
  });
  if (ok) {
    await appendAudit({
      ownerUserId,
      type: "vault.delete",
      detail: `Deleted vault item ${id}`,
    });
  }
  return ok;
}

export async function listVaultLabels(ownerUserId: string) {
  const items = await listVaultItems(ownerUserId);
  return items.map((i) => ({
    id: i.id,
    label: i.label,
    username: i.username,
    origin: i.origin,
  }));
}

export async function createVaultJobToken(input: {
  ownerUserId: string;
  jobId: string;
}) {
  const key = new TextEncoder().encode(getConfig().sessionSecret);
  return new SignJWT({
    purpose: "vault-reveal",
    ownerUserId: input.ownerUserId,
    jobId: input.jobId,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("2h")
    .sign(key);
}

export async function verifyVaultJobToken(token: string) {
  const key = new TextEncoder().encode(getConfig().sessionSecret);
  const { payload } = await jwtVerify(token, key);
  if (payload.purpose !== "vault-reveal") throw new Error("Invalid token");
  if (typeof payload.ownerUserId !== "string") throw new Error("Invalid token");
  if (typeof payload.jobId !== "string") throw new Error("Invalid token");
  return {
    ownerUserId: payload.ownerUserId,
    jobId: payload.jobId,
  };
}

export async function revealVaultItem(input: {
  ownerUserId: string;
  jobId: string;
  itemId?: string;
  label?: string;
}) {
  const store = await getStore();
  const list = store.vaultItems[input.ownerUserId] ?? [];
  const item = list.find((v) => {
    if (v.ownerUserId !== input.ownerUserId) return false;
    if (input.itemId) return v.id === input.itemId;
    if (input.label) return v.label.toLowerCase() === input.label.toLowerCase();
    return false;
  });
  if (!item) return null;
  const secret = decryptSecret(item.ciphertext, VAULT_PURPOSE, input.ownerUserId);
  await appendAudit({
    ownerUserId: input.ownerUserId,
    type: "vault.reveal",
    detail: `Job ${input.jobId} revealed vault item ${item.label}`,
  });
  return {
    id: item.id,
    label: item.label,
    username: item.username,
    origin: item.origin,
    secret,
  };
}
