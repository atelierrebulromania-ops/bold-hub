// Digital Vouchers: the shared, pure rules (status, dates in the campaign's time zone, links with UTM tags,
// allowed origins, labels). No server or browser APIs, so pages, route handlers and tests all use it.

export const voucherStatuses = ["draft", "scheduled", "active", "expired", "archived"] as const;
export type VoucherStatus = (typeof voucherStatuses)[number];

export const discountTypes = { percentage: "Percentage", fixed_amount: "Fixed amount" } as const;
export type DiscountType = keyof typeof discountTypes;

export const voucherLanguages = { ro: "Română", en: "English" } as const;
export type VoucherLanguage = keyof typeof voucherLanguages;

// Every event the module records. The public events endpoint accepts only the ones a browser observes;
// the others are written by the server itself (wallet links, e-mail delivery) so they cannot be faked.
export const voucherEventTypes = [
  "landing_page_view", "discount_code_copy", "shop_now_click", "google_wallet_request", "google_wallet_link_generated",
  "apple_wallet_request", "voucher_image_download", "email_voucher_requested", "email_voucher_sent",
] as const;
export type VoucherEventType = (typeof voucherEventTypes)[number];
export const clientEventTypes: readonly VoucherEventType[] = ["landing_page_view", "discount_code_copy", "shop_now_click", "voucher_image_download"];

export type Voucher = {
  id: string; name: string; internal_name: string; brand: string; slug: string;
  discount_code: string; discount_type: DiscountType; discount_value: number; currency: string | null;
  short_description: string; long_description: string; starts_at: string; expires_at: string; timezone: string;
  language: VoucherLanguage; terms: string; internal_notes: string;
  logo_path: string | null; hero_path: string | null; background_color: string; text_color: string; accent_color: string;
  title: string; subtitle: string; show_discount_value: boolean; show_discount_code: boolean;
  website_url: string | null; landing_url: string | null; discount_url: string | null; qr_url: string | null;
  utm_source: string; utm_medium: string; utm_campaign: string; extra_origins: string[];
  google_wallet_enabled: boolean; apple_wallet_enabled: boolean; image_download_enabled: boolean; email_enabled: boolean;
  published: boolean; archived_at: string | null; created_at: string; updated_at: string;
};

export const voucherColumns = "id,name,internal_name,brand,slug,discount_code,discount_type,discount_value,currency,short_description,long_description,starts_at,expires_at,timezone,language,terms,internal_notes,logo_path,hero_path,background_color,text_color,accent_color,title,subtitle,show_discount_value,show_discount_code,website_url,landing_url,discount_url,qr_url,utm_source,utm_medium,utm_campaign,extra_origins,google_wallet_enabled,apple_wallet_enabled,image_download_enabled,email_enabled,published,archived_at,created_at,updated_at";

// numeric columns arrive as strings from PostgREST.
export function toVoucher(row: Record<string, unknown>): Voucher {
  return { ...(row as unknown as Voucher), discount_value: Number(row.discount_value), extra_origins: (row.extra_origins as string[] | null) ?? [] };
}

// Draft and archived are set by people; scheduled / active / expired follow from the dates (instants, so the
// time zone only matters for how the dates were typed and are shown).
export function voucherStatus(voucher: Pick<Voucher, "published" | "archived_at" | "starts_at" | "expires_at">, now = new Date()): VoucherStatus {
  if (voucher.archived_at) return "archived";
  if (!voucher.published) return "draft";
  if (now.getTime() < new Date(voucher.starts_at).getTime()) return "scheduled";
  if (now.getTime() > new Date(voucher.expires_at).getTime()) return "expired";
  return "active";
}

export const statusLabels: Record<VoucherStatus, string> = { draft: "Draft", scheduled: "Scheduled", active: "Active", expired: "Expired", archived: "Archived" };

// ---- Dates in the campaign's time zone ---------------------------------------------------------------------

function zoneParts(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
  }).formatToParts(date);
  const get = (type: string) => Number(parts.find(part => part.type === type)?.value);
  return { year: get("year"), month: get("month"), day: get("day"), hour: get("hour"), minute: get("minute"), second: get("second") };
}

// Minutes the zone is ahead of UTC at that instant (Bucharest: 120 in winter, 180 in summer).
export function zoneOffsetMinutes(date: Date, timeZone: string) {
  const p = zoneParts(date, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return Math.round((asUtc - Math.floor(date.getTime() / 1000) * 1000) / 60000);
}

const localPattern = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/;

// "2026-12-01T00:00:00" typed for Europe/Bucharest → the instant, as an ISO string in UTC. Null if invalid.
export function zonedToUtc(local: string, timeZone: string): string | null {
  const match = localPattern.exec(local);
  if (!match) return null;
  const [year, month, day, hour, minute, second] = match.slice(1).map(value => Number(value ?? 0));
  if (month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59 || second > 59) return null;
  const naive = Date.UTC(year, month - 1, day, hour, minute, second);
  // Two passes settle the offset also next to a daylight-saving change.
  let guess = naive - zoneOffsetMinutes(new Date(naive), timeZone) * 60000;
  guess = naive - zoneOffsetMinutes(new Date(guess), timeZone) * 60000;
  const check = zoneParts(new Date(guess), timeZone);
  if (check.year !== year || check.month !== month || check.day !== day) return null;
  return new Date(guess).toISOString();
}

const pad = (value: number) => String(value).padStart(2, "0");

// The instant as typed in the zone: "2026-12-01T00:00:00" (for datetime-local inputs).
export function utcToZoned(iso: string, timeZone: string) {
  const p = zoneParts(new Date(iso), timeZone);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}T${pad(p.hour)}:${pad(p.minute)}:${pad(p.second)}`;
}

// ISO 8601 with the zone's offset, as Google Wallet expects: "2026-12-01T00:00:00+02:00".
export function zonedIso(iso: string, timeZone: string) {
  const offset = zoneOffsetMinutes(new Date(iso), timeZone);
  const sign = offset < 0 ? "-" : "+";
  return `${utcToZoned(iso, timeZone)}${sign}${pad(Math.floor(Math.abs(offset) / 60))}:${pad(Math.abs(offset) % 60)}`;
}

// "01.12.2026" in the zone.
export function zonedDate(iso: string, timeZone: string) {
  const p = zoneParts(new Date(iso), timeZone);
  return `${pad(p.day)}.${pad(p.month)}.${p.year}`;
}

export function zonedDateTime(iso: string, timeZone: string) {
  const p = zoneParts(new Date(iso), timeZone);
  return `${pad(p.day)}.${pad(p.month)}.${p.year}, ${pad(p.hour)}:${pad(p.minute)}`;
}

// "01.12.2026 – 31.12.2026"
export function validityLabel(voucher: Pick<Voucher, "starts_at" | "expires_at" | "timezone">) {
  return `${zonedDate(voucher.starts_at, voucher.timezone)} – ${zonedDate(voucher.expires_at, voucher.timezone)}`;
}

// ---- Benefit ------------------------------------------------------------------------------------------------

const currencySigns: Record<string, string> = { RON: " lei", EUR: " €", USD: " $", GBP: " £" };

// "25%", "50 lei", "12.50 €"
export function benefitLabel(voucher: Pick<Voucher, "discount_type" | "discount_value" | "currency">) {
  const value = Number.isInteger(voucher.discount_value) ? String(voucher.discount_value) : voucher.discount_value.toFixed(2);
  if (voucher.discount_type === "percentage") return `${value}%`;
  const currency = voucher.currency ?? "";
  return `${value}${currencySigns[currency] ?? ` ${currency}`}`;
}

// ---- Links --------------------------------------------------------------------------------------------------

export type Utm = { source: string; medium: string; campaign: string };

// Adds UTM tags to a link. A Shopify discount link (/discount/CODE?redirect=/path) applies the code and then
// redirects, so the tags go on the page it redirects to, where the shop's analytics sees them.
export function withUtm(url: string | null, utm: Utm): string | null {
  if (!url) return null;
  let parsed: URL;
  try { parsed = new URL(url); } catch { return url; }
  const tags = Object.entries({ utm_source: utm.source, utm_medium: utm.medium, utm_campaign: utm.campaign }).filter(([, value]) => value);
  if (!tags.length) return parsed.toString();
  const redirect = parsed.searchParams.get("redirect");
  if (/^\/discount\//.test(parsed.pathname) && redirect && redirect.startsWith("/")) {
    const target = new URL(redirect, parsed.origin);
    for (const [key, value] of tags) target.searchParams.set(key, value);
    parsed.searchParams.set("redirect", `${target.pathname}${target.search}`);
    return parsed.toString();
  }
  for (const [key, value] of tags) parsed.searchParams.set(key, value);
  return parsed.toString();
}

export const campaignUtm = (voucher: Pick<Voucher, "utm_source" | "utm_medium" | "utm_campaign">): Utm =>
  ({ source: voucher.utm_source, medium: voucher.utm_medium, campaign: voucher.utm_campaign });

// Links opened from the Wallet pass are tagged as coming from the wallet, in the same campaign.
export const walletUtm = (voucher: Pick<Voucher, "utm_campaign">, platform: "google_wallet" | "apple_wallet"): Utm =>
  ({ source: platform, medium: "wallet", campaign: voucher.utm_campaign });

// Where the shop button goes: the discount link (applies the code), else the landing page, else the website.
export function shopUrl(voucher: Pick<Voucher, "discount_url" | "landing_url" | "website_url">, utm: Utm) {
  return withUtm(voucher.discount_url ?? voucher.landing_url ?? voucher.website_url, utm);
}

// The QR destination, with the campaign's UTM tags.
export function qrDestination(voucher: Pick<Voucher, "qr_url" | "landing_url" | "utm_source" | "utm_medium" | "utm_campaign">) {
  return withUtm(voucher.qr_url ?? voucher.landing_url, campaignUtm(voucher));
}

// The sites allowed to call the public API from a browser: the campaign's own sites (each with and
// without "www."), plus the extra ones set on the voucher (e.g. the shop's myshopify.com preview domain).
export function allowedOrigins(voucher: Pick<Voucher, "website_url" | "landing_url" | "discount_url" | "qr_url" | "extra_origins">) {
  const origins = new Set<string>();
  for (const url of [voucher.website_url, voucher.landing_url, voucher.discount_url, voucher.qr_url, ...voucher.extra_origins]) {
    if (!url) continue;
    try {
      const { protocol, host } = new URL(url);
      if (protocol !== "https:") continue;
      origins.add(`https://${host}`);
      origins.add(host.startsWith("www.") ? `https://${host.slice(4)}` : `https://www.${host}`);
    } catch { /* ignored */ }
  }
  return [...origins];
}

// ---- Labels shown on the voucher (Wallet fields, image) -------------------------------------------------------

export const voucherLabels: Record<VoucherLanguage, { code: string; validity: string; benefit: string; shop: string; terms: string; discount: string; off: string }> = {
  ro: { code: "Cod de reducere", validity: "Valabilitate", benefit: "Beneficiu", shop: "Cumpără online", terms: "Condiții de utilizare", discount: "reducere", off: "reducere" },
  en: { code: "Discount code", validity: "Valid", benefit: "Benefit", shop: "Shop online", terms: "Terms and conditions", discount: "discount", off: "off" },
};

// Device class from the browser's user agent (nothing else is kept from it).
export function deviceType(userAgent: string | null): "mobile" | "tablet" | "desktop" | "unknown" {
  if (!userAgent) return "unknown";
  if (/iPad|Tablet|PlayBook|Silk|(Android(?!.*Mobile))/i.test(userAgent)) return "tablet";
  if (/Mobi|iPhone|iPod|Android|Windows Phone/i.test(userAgent)) return "mobile";
  if (/Windows|Macintosh|Linux|CrOS/i.test(userAgent)) return "desktop";
  return "unknown";
}

// Only the host of a referrer ("www.instagram.com"), never the full address.
export function referrerHost(referrer: string | null | undefined) {
  if (!referrer) return null;
  try { return new URL(referrer).host.slice(0, 255) || null; } catch { return null; }
}
