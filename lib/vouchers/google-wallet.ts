import "server-only";
import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { googleWalletIds, offerClass, offerObject, saveClaims, saveUrlPrefix, signJwt, type WalletIds } from "./google-payload";
import type { Voucher } from "./voucher";

// Google Wallet (Offers) on the server: the service account from GOOGLE_WALLET_CREDENTIALS_JSON signs the
// OAuth assertion and the Add to Google Wallet JWT. The JSON is parsed only here; the private key never leaves
// this module, is never logged and never sent to a browser. Error messages kept for the admin are Google's
// own short messages, never request contents.

const scope = "https://www.googleapis.com/auth/wallet_object.issuer";
const api = "https://walletobjects.googleapis.com/walletobjects/v1";

type Client = SupabaseClient<Database>;
type ServiceAccount = { client_email: string; private_key: string; token_uri: string };

export type GoogleWalletConfig =
  | { ready: true; issuerId: string; projectId: string | null; account: ServiceAccount }
  | { ready: false; reason: string; issuerId: string | null; projectId: string | null; enabled: boolean; credentials: "missing" | "invalid" | "present" };

let cached: { source: string; config: GoogleWalletConfig } | null = null;

// Read once per instance; a broken or missing JSON makes the integration "not configured", nothing else.
export function googleWalletConfig(): GoogleWalletConfig {
  const enabled = process.env.GOOGLE_WALLET_ENABLED === "true";
  const issuerId = process.env.GOOGLE_WALLET_ISSUER_ID?.trim() || null;
  const projectId = process.env.GOOGLE_WALLET_PROJECT_ID?.trim() || null;
  const source = process.env.GOOGLE_WALLET_CREDENTIALS_JSON ?? "";
  if (cached && cached.source === `${enabled}|${issuerId}|${source}`) return cached.config;
  let config: GoogleWalletConfig;
  let account: ServiceAccount | null = null;
  let credentials: "missing" | "invalid" | "present" = source ? "invalid" : "missing";
  if (source) {
    try {
      const parsed = JSON.parse(source) as Partial<ServiceAccount> & { type?: string };
      if (parsed.type === "service_account" && parsed.client_email && parsed.private_key?.includes("PRIVATE KEY")) {
        account = { client_email: parsed.client_email, private_key: parsed.private_key, token_uri: parsed.token_uri || "https://oauth2.googleapis.com/token" };
        credentials = "present";
      }
    } catch { /* stays "invalid"; the content is never echoed */ }
  }
  if (!enabled) config = { ready: false, reason: "Google Wallet is turned off (GOOGLE_WALLET_ENABLED is not true).", issuerId, projectId, enabled, credentials };
  else if (!issuerId || !/^\d{6,25}$/.test(issuerId)) config = { ready: false, reason: "GOOGLE_WALLET_ISSUER_ID is missing or not a number.", issuerId, projectId, enabled, credentials };
  else if (!account) config = { ready: false, reason: credentials === "missing" ? "GOOGLE_WALLET_CREDENTIALS_JSON is not set." : "GOOGLE_WALLET_CREDENTIALS_JSON is not a valid service account key.", issuerId, projectId, enabled, credentials };
  else config = { ready: true, issuerId, projectId, account };
  cached = { source: `${enabled}|${issuerId}|${source}`, config };
  return config;
}

let token: { value: string; expires: number; email: string } | null = null;

async function accessToken(account: ServiceAccount) {
  if (token && token.email === account.client_email && token.expires > Date.now() + 60_000) return token.value;
  const now = Math.floor(Date.now() / 1000);
  const assertion = signJwt({ iss: account.client_email, scope, aud: account.token_uri, iat: now, exp: now + 3600 }, account.private_key);
  const response = await fetch(account.token_uri, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion }),
    cache: "no-store",
  });
  const data = await response.json().catch(() => ({})) as { access_token?: string; expires_in?: number; error?: string; error_description?: string };
  if (!response.ok || !data.access_token) throw new WalletError(`Google sign-in failed (${response.status}${data.error ? `: ${data.error}` : ""}).`);
  token = { value: data.access_token, expires: Date.now() + (data.expires_in ?? 3600) * 1000, email: account.client_email };
  return token.value;
}

export class WalletError extends Error {}

async function call(account: ServiceAccount, method: "GET" | "POST" | "PUT", path: string, body?: object) {
  const response = await fetch(`${api}${path}`, {
    method,
    headers: { Authorization: `Bearer ${await accessToken(account)}`, ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
    cache: "no-store",
  });
  const data = await response.json().catch(() => ({})) as { error?: { message?: string } } & Record<string, unknown>;
  return { status: response.status, data };
}

const errorText = (status: number, data: { error?: { message?: string } }) =>
  `Google Wallet answered ${status}${data.error?.message ? `: ${String(data.error.message).slice(0, 300)}` : ""}.`;

// Creates the resource, or replaces it when it exists. Safe to repeat: the id is fixed, so no duplicates.
async function upsert(account: ServiceAccount, kind: "offerClass" | "offerObject", resource: { id: string }) {
  const id = encodeURIComponent(resource.id);
  const existing = await call(account, "GET", `/${kind}/${id}`);
  if (existing.status === 200) {
    const updated = await call(account, "PUT", `/${kind}/${id}`, resource);
    if (updated.status !== 200) throw new WalletError(errorText(updated.status, updated.data));
    return "updated" as const;
  }
  if (existing.status !== 404) throw new WalletError(errorText(existing.status, existing.data));
  const created = await call(account, "POST", `/${kind}`, resource);
  // 409: created meanwhile by a parallel request; replace it with this version.
  if (created.status === 409) {
    const updated = await call(account, "PUT", `/${kind}/${id}`, resource);
    if (updated.status !== 200) throw new WalletError(errorText(updated.status, updated.data));
    return "updated" as const;
  }
  if (created.status !== 200) throw new WalletError(errorText(created.status, created.data));
  return "created" as const;
}

// Checks the credentials and the issuer access with one read-only call.
export async function testGoogleWallet(): Promise<{ ok: true; message: string } | { ok: false; message: string }> {
  const config = googleWalletConfig();
  if (!config.ready) return { ok: false, message: config.reason };
  try {
    const result = await call(config.account, "GET", `/offerClass?issuerId=${encodeURIComponent(config.issuerId)}&maxResults=1`);
    if (result.status === 200) return { ok: true, message: `Connected. The service account can read the offers of issuer ${config.issuerId}.` };
    return { ok: false, message: errorText(result.status, result.data) };
  } catch (error) {
    return { ok: false, message: error instanceof WalletError ? error.message : "Google Wallet could not be reached." };
  }
}

export const publicAssetUrl = (path: string) =>
  `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/digital-voucher-assets/${path.split("/").map(encodeURIComponent).join("/")}`;

const hash = (value: object) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

type ResourceRow = { resource_type: string; external_id: string; sync_status: string; payload_hash: string | null };

export type SyncResult = { ok: true; ids: WalletIds; changed: boolean } | { ok: false; error: string; ids: WalletIds | null };

// Brings the voucher's class and shared object at Google up to date and records the ids and the outcome.
// Unchanged payloads are skipped unless `force`. `db` must be allowed to write wallet resources (the manager's
// session, or the service client in the public API).
export async function syncGoogleWallet(db: Client, voucher: Voucher, force = false): Promise<SyncResult> {
  const config = googleWalletConfig();
  if (!config.ready) return { ok: false, error: config.reason, ids: null };
  const { data: rows } = await db.from("digital_voucher_wallet_resources")
    .select("resource_type,external_id,sync_status,payload_hash").eq("voucher_id", voucher.id).eq("platform", "google");
  const stored = Object.fromEntries((rows ?? []).map(row => [row.resource_type, row])) as Record<string, ResourceRow | undefined>;
  const ids = googleWalletIds(config.issuerId, voucher, { classId: stored.class?.external_id, objectId: stored.object?.external_id });
  const resources = [
    { type: "class" as const, kind: "offerClass" as const, body: offerClass(voucher, ids, publicAssetUrl) },
    { type: "object" as const, kind: "offerObject" as const, body: offerObject(voucher, ids) },
  ];
  let changed = false;
  for (const resource of resources) {
    const payloadHash = hash(resource.body);
    const row = stored[resource.type];
    if (!force && row?.sync_status === "synced" && row.payload_hash === payloadHash) continue;
    const now = new Date().toISOString();
    try {
      await upsert(config.account, resource.kind, resource.body);
      changed = true;
      await db.from("digital_voucher_wallet_resources").upsert({
        voucher_id: voucher.id, platform: "google", resource_type: resource.type, external_id: resource.body.id,
        sync_status: "synced", payload_hash: payloadHash, last_synced_at: now, last_error: null, updated_at: now,
      }, { onConflict: "voucher_id,platform,resource_type" });
    } catch (error) {
      const message = error instanceof WalletError ? error.message : "Google Wallet could not be reached.";
      await db.from("digital_voucher_wallet_resources").upsert({
        voucher_id: voucher.id, platform: "google", resource_type: resource.type, external_id: resource.body.id,
        sync_status: "error", last_error: message, updated_at: now,
      }, { onConflict: "voucher_id,platform,resource_type" });
      return { ok: false, error: message, ids };
    }
  }
  return { ok: true, ids, changed };
}

// The Add to Google Wallet link for the voucher's shared object.
export function googleSaveUrl(ids: WalletIds, origins: string[]) {
  const config = googleWalletConfig();
  if (!config.ready) return null;
  return `${saveUrlPrefix}${signJwt(saveClaims(config.account.client_email, ids, origins), config.account.private_key)}`;
}
