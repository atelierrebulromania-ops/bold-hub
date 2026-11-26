import "server-only";
import { createHmac } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { effectiveRole, marketingRoles } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { googleWalletConfig, publicAssetUrl } from "./google-wallet";
import {
  allowedOrigins, benefitLabel, campaignUtm, deviceType, qrDestination, referrerHost, shopUrl, toVoucher, validityLabel,
  voucherColumns, voucherStatus, type Voucher, type VoucherEventType,
} from "./voucher";

// Server side of Digital Vouchers: access check for admin route handlers, and the helpers of the public API
// (published fields only, CORS, rate limiting, anonymous events).

type Client = SupabaseClient<Database>;

// Who manages vouchers: the same people as the Marketing section (checked again by row security).
export const voucherRoles = marketingRoles;

export async function voucherAccess(): Promise<{ supabase: Client; userId: string } | null> {
  const supabase = await createClient();
  const { data: authData } = await supabase.auth.getClaims();
  const userId = authData?.claims?.sub;
  if (!userId) return null;
  const { data: profile } = await supabase.from("app_users").select("role,active").eq("id", userId).maybeSingle();
  if (!profile?.active) return null;
  const role = await effectiveRole(profile.role);
  return voucherRoles.includes(role) ? { supabase, userId } : null;
}

export async function loadVoucher(db: Client, id: string) {
  const { data } = await db.from("digital_vouchers").select(voucherColumns).eq("id", id).maybeSingle();
  return data ? toVoucher(data) : null;
}

// Apple Wallet is not built yet (no Apple Developer account and certificates): it stays "not configured" even
// if APPLE_WALLET_ENABLED is turned on, so customers never see a button that cannot work.
export function appleWalletReady(): boolean {
  return false;
}

export function appleWalletStatus() {
  const flag = process.env.APPLE_WALLET_ENABLED === "true";
  return { ready: appleWalletReady(), flag, reason: "Not configured: the Apple Developer account and the pass certificates are pending." };
}

export const googleWalletReady = () => googleWalletConfig().ready;

// ---- Public API ----------------------------------------------------------------------------------------------

const slugPattern = /^[a-z0-9]+(-[a-z0-9]+)*$/;

export type PublicLookup =
  | { ok: true; voucher: Voucher; db: Client }
  | { ok: false; status: number; error: string; message: string };

// A voucher the public may see: published and not archived. Drafts look exactly like missing slugs.
export async function publicVoucher(slug: string): Promise<PublicLookup> {
  if (!slugPattern.test(slug) || slug.length > 60) return { ok: false, status: 404, error: "not_found", message: "This voucher does not exist." };
  const db = createAdminClient();
  if (!db) return { ok: false, status: 503, error: "unavailable", message: "The service is not available right now." };
  const { data } = await db.from("digital_vouchers").select(voucherColumns).eq("slug", slug).maybeSingle();
  if (!data || !data.published) return { ok: false, status: 404, error: "not_found", message: "This voucher does not exist." };
  const voucher = toVoucher(data);
  if (voucher.archived_at) return { ok: false, status: 410, error: "archived", message: "This campaign has ended." };
  return { ok: true, voucher, db };
}

// What the landing page gets: nothing internal (no notes, internal name, audit, ids or wallet resources).
export function publicPayload(voucher: Voucher, apiBase: string, now = new Date()) {
  const status = voucherStatus(voucher, now);
  const live = status === "scheduled" || status === "active";
  const endpoint = (path: string) => `${apiBase}/api/public/vouchers/${voucher.slug}${path}`;
  return {
    slug: voucher.slug,
    brand: voucher.brand,
    name: voucher.name,
    title: voucher.title || voucher.name,
    subtitle: voucher.subtitle,
    shortDescription: voucher.short_description,
    longDescription: voucher.long_description,
    language: voucher.language,
    status,
    discount: {
      type: voucher.discount_type,
      value: voucher.discount_value,
      currency: voucher.currency,
      label: voucher.show_discount_value ? benefitLabel(voucher) : null,
      // The code stays private once the campaign is over.
      code: voucher.show_discount_code && live ? voucher.discount_code : null,
    },
    validity: {
      startsAt: voucher.starts_at,
      expiresAt: voucher.expires_at,
      timezone: voucher.timezone,
      label: validityLabel(voucher),
    },
    terms: voucher.terms,
    design: {
      backgroundColor: voucher.background_color,
      textColor: voucher.text_color,
      accentColor: voucher.accent_color,
      logoUrl: voucher.logo_path ? publicAssetUrl(voucher.logo_path) : null,
      heroUrl: voucher.hero_path ? publicAssetUrl(voucher.hero_path) : null,
    },
    links: {
      website: voucher.website_url,
      landing: voucher.landing_url,
      shop: live ? shopUrl(voucher, campaignUtm(voucher)) : voucher.website_url,
      qr: qrDestination(voucher),
    },
    features: {
      googleWallet: live && voucher.google_wallet_enabled && googleWalletReady(),
      appleWallet: live && voucher.apple_wallet_enabled && appleWalletReady(),
      imageDownload: live && voucher.image_download_enabled,
      email: false,
    },
    endpoints: {
      googleWallet: endpoint("/google-wallet"),
      image: endpoint("/image"),
      events: endpoint("/events"),
    },
  };
}

// CORS: only the campaign's own sites (and the extra ones set on it) get the Allow-Origin header.
export function corsHeaders(request: Request, voucher: Voucher | null, methods = "GET, OPTIONS"): Record<string, string> {
  const origin = request.headers.get("origin");
  const headers: Record<string, string> = { "Cache-Control": "no-store", Vary: "Origin", "X-Content-Type-Options": "nosniff" };
  if (origin && voucher && allowedOrigins(voucher).includes(origin)) {
    headers["Access-Control-Allow-Origin"] = origin;
    headers["Access-Control-Allow-Methods"] = methods;
    headers["Access-Control-Allow-Headers"] = "Content-Type";
    headers["Access-Control-Max-Age"] = "600";
  }
  return headers;
}

export function originAllowed(request: Request, voucher: Voucher) {
  const origin = request.headers.get("origin");
  if (!origin) return true;
  return allowedOrigins(voucher).includes(origin) || origin === new URL(request.url).origin;
}

// The caller's address, only to count requests. It is hashed with a server secret and the bucket name, so
// the counter table holds no IP address; the counters are dropped after a day.
function clientKey(request: Request, bucket: string) {
  const ip = request.headers.get("x-real-ip") ?? request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";
  const secret = process.env.CRON_SECRET ?? process.env.SUPABASE_SERVICE_ROLE_KEY ?? "boldhub";
  return createHmac("sha256", secret).update(`${bucket}|${ip}`).digest("hex").slice(0, 40);
}

export const rateLimits = { read: 120, wallet: 20, events: 60, image: 20 } as const;

// True while the caller is under the limit for this minute. If the counter cannot be reached the request is
// allowed: a database hiccup must not break the landing page.
export async function withinRate(db: Client, request: Request, bucket: keyof typeof rateLimits) {
  const { data, error } = await db.rpc("digital_voucher_rate_hit", { p_key: clientKey(request, bucket), p_limit: rateLimits[bucket], p_window_seconds: 60 });
  return error ? true : data !== false;
}

const sessionPattern = /^[A-Za-z0-9_-]{8,64}$/;
const tag = (value: unknown) => (typeof value === "string" && value.trim() ? value.trim().slice(0, 100) : null);

export type EventContext = { sessionId?: unknown; utmSource?: unknown; utmMedium?: unknown; utmCampaign?: unknown; referrer?: unknown };

// One anonymous event: the voucher, the type, a random session id the page keeps, UTM tags, the device class
// and the referring host. No IP, no user agent string, no personal data.
export async function recordEvent(db: Client, request: Request, voucherId: string, type: VoucherEventType, context: EventContext = {}) {
  const sessionId = typeof context.sessionId === "string" && sessionPattern.test(context.sessionId) ? context.sessionId : null;
  const { error } = await db.from("digital_voucher_events").insert({
    voucher_id: voucherId,
    event_type: type,
    session_id: sessionId,
    utm_source: tag(context.utmSource),
    utm_medium: tag(context.utmMedium),
    utm_campaign: tag(context.utmCampaign),
    device_type: deviceType(request.headers.get("user-agent")),
    referrer_host: referrerHost(typeof context.referrer === "string" ? context.referrer : request.headers.get("referer")),
  });
  return !error;
}

// Context from the query string (wallet link opened from the landing page).
export function queryContext(url: URL): EventContext {
  return {
    sessionId: url.searchParams.get("session") ?? undefined,
    utmSource: url.searchParams.get("utm_source") ?? undefined,
    utmMedium: url.searchParams.get("utm_medium") ?? undefined,
    utmCampaign: url.searchParams.get("utm_campaign") ?? undefined,
    referrer: url.searchParams.get("ref") ?? undefined,
  };
}

// The public base address of BoldHub, for links in the payload.
export function apiBase(request: Request) {
  const url = new URL(request.url);
  return `${url.protocol}//${url.host}`;
}

// ---- Admin read helpers -------------------------------------------------------------------------------------

export type EventCounts = Partial<Record<VoucherEventType, { total: number; sessions: number }>>;

// Totals and unique sessions per voucher and event type.
export async function voucherStats(db: Client, voucherId?: string) {
  const { data, error } = await db.rpc("digital_voucher_stats", voucherId ? { p_voucher_id: voucherId } : {});
  const byVoucher = new Map<string, EventCounts>();
  for (const row of data ?? []) {
    const counts = byVoucher.get(row.voucher_id) ?? {};
    counts[row.event_type as VoucherEventType] = { total: Number(row.total), sessions: Number(row.sessions) };
    byVoucher.set(row.voucher_id, counts);
  }
  return { byVoucher, error: Boolean(error) };
}

export type WalletState = { label: string; tone: "ok" | "remarks" | "inactive" | "error"; detail?: string };

type ResourceState = { voucher_id: string; resource_type: string; external_id: string; sync_status: string; last_synced_at: string | null; last_error: string | null };

export async function walletResources(db: Client, voucherId?: string) {
  let query = db.from("digital_voucher_wallet_resources").select("voucher_id,resource_type,external_id,sync_status,last_synced_at,last_error").eq("platform", "google");
  if (voucherId) query = query.eq("voucher_id", voucherId);
  const { data } = await query;
  const byVoucher = new Map<string, ResourceState[]>();
  for (const row of data ?? []) byVoucher.set(row.voucher_id, [...(byVoucher.get(row.voucher_id) ?? []), row]);
  return byVoucher;
}

// The Google Wallet column: not configured (server), off (voucher), not synced yet, error, or synced.
export function googleWalletState(voucher: Pick<Voucher, "google_wallet_enabled">, resources: ResourceState[] | undefined): WalletState {
  if (!voucher.google_wallet_enabled) return { label: "Disabled", tone: "inactive" };
  if (!googleWalletReady()) return { label: "Not configured", tone: "inactive", detail: googleWalletConfig().ready ? undefined : (googleWalletConfig() as { reason: string }).reason };
  const failed = resources?.find(row => row.sync_status === "error");
  if (failed) return { label: "Sync error", tone: "error", detail: failed.last_error ?? undefined };
  if (resources?.length === 2 && resources.every(row => row.sync_status === "synced")) return { label: "Synced", tone: "ok" };
  return { label: "Not synced yet", tone: "remarks", detail: "Created at Google on the first save request or with Sync now." };
}
