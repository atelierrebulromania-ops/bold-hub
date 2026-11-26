// Validation of the voucher form, shared by the server actions and the tests. Messages are in English, like
// the rest of the module, and name the field.
import { discountTypes, voucherLanguages, zonedToUtc, type DiscountType, type VoucherLanguage } from "./voucher.ts";

export type FieldErrors = Record<string, string>;
export type Parsed<T> = { ok: true; value: T } | { ok: false; errors: FieldErrors };

const text = (value: unknown) => (typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "");
const multiline = (value: unknown) => (typeof value === "string" ? value.replace(/\r\n/g, "\n").trim() : "");
const imagePattern = /^vouchers\/[0-9a-f-]{36}\.(jpg|png)$/;
const colorPattern = /^#[0-9A-Fa-f]{6}$/;
const utmPattern = /^[A-Za-z0-9_.-]*$/;

export const supportedTimezones = ["Europe/Bucharest"] as const;

export type VoucherInput = {
  name: string; internalName: string; brand: string; slug: string; discountCode: string;
  discountType: DiscountType; discountValue: number; currency: string | null;
  shortDescription: string; longDescription: string; startsAt: string; expiresAt: string; timezone: string;
  language: VoucherLanguage; terms: string; internalNotes: string;
  logoPath: string | null; heroPath: string | null; backgroundColor: string; textColor: string; accentColor: string;
  title: string; subtitle: string; showDiscountValue: boolean; showDiscountCode: boolean;
  websiteUrl: string | null; landingUrl: string | null; discountUrl: string | null; qrUrl: string | null;
  utmSource: string; utmMedium: string; utmCampaign: string; extraOrigins: string[];
  googleWalletEnabled: boolean; appleWalletEnabled: boolean; imageDownloadEnabled: boolean; emailEnabled: boolean;
  published: boolean;
};

export function slugify(value: string) {
  return value.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60).replace(/-+$/, "");
}

function httpsUrl(value: unknown, field: string, errors: FieldErrors, label: string) {
  const raw = text(value);
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:") throw new Error("protocol");
    if (raw.length > 500) { errors[field] = `${label} can have at most 500 characters.`; return null; }
    return url.toString();
  } catch {
    errors[field] = `${label} must be a full https:// address.`;
    return null;
  }
}

export function parseVoucher(input: Record<string, unknown>): Parsed<VoucherInput> {
  const errors: FieldErrors = {};
  const limit = (field: string, value: string, max: number, label: string) => { if (value.length > max) errors[field] = `${label} can have at most ${max} characters.`; };

  const name = text(input.name);
  if (!name) errors.name = "Enter the campaign name.";
  limit("name", name, 120, "The campaign name");
  const internalName = text(input.internalName);
  limit("internalName", internalName, 120, "The internal name");
  const brand = text(input.brand);
  if (!brand) errors.brand = "Enter the brand.";
  limit("brand", brand, 60, "The brand");
  const slug = text(input.slug).toLowerCase();
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug) || slug.length > 60) errors.slug = "Use lowercase letters, digits and single hyphens, e.g. private-gift.";
  const discountCode = text(input.discountCode).toUpperCase();
  if (!/^[A-Z0-9_-]{2,40}$/.test(discountCode)) errors.discountCode = "Use 2–40 letters, digits, - or _, e.g. GIFT25.";

  const discountType = text(input.discountType) as DiscountType;
  if (!(discountType in discountTypes)) errors.discountType = "Choose the discount type.";
  const valueText = text(input.discountValue).replace(",", ".").replace(/%$/, "");
  const discountValue = /^\d+(\.\d{1,2})?$/.test(valueText) ? Number(valueText) : NaN;
  if (!(discountValue > 0)) errors.discountValue = "Enter the discount as a number, e.g. 25.";
  else if (discountType === "percentage" && discountValue > 100) errors.discountValue = "A percentage can be at most 100.";
  else if (discountValue >= 100_000_000) errors.discountValue = "The value is too large.";
  const currencyRaw = text(input.currency).toUpperCase();
  const currency = discountType === "fixed_amount" ? currencyRaw || null : null;
  if (discountType === "fixed_amount" && !/^[A-Z]{3}$/.test(currencyRaw)) errors.currency = "Choose the currency of the fixed amount.";

  const shortDescription = multiline(input.shortDescription);
  limit("shortDescription", shortDescription, 300, "The short description");
  const longDescription = multiline(input.longDescription);
  limit("longDescription", longDescription, 2000, "The long description");

  const timezone = text(input.timezone) || "Europe/Bucharest";
  if (!(supportedTimezones as readonly string[]).includes(timezone)) errors.timezone = "Choose the time zone.";
  const startsAt = zonedToUtc(text(input.startsAt), timezone);
  if (!startsAt) errors.startsAt = "Choose the start date and time.";
  const expiresAt = zonedToUtc(text(input.expiresAt), timezone);
  if (!expiresAt) errors.expiresAt = "Choose the expiration date and time.";
  if (startsAt && expiresAt && new Date(expiresAt) <= new Date(startsAt)) errors.expiresAt = "The expiration must be after the start.";

  const language = (text(input.language) || "ro") as VoucherLanguage;
  if (!(language in voucherLanguages)) errors.language = "Choose the language.";
  const terms = multiline(input.terms);
  limit("terms", terms, 3000, "The terms");
  const internalNotes = multiline(input.internalNotes);
  limit("internalNotes", internalNotes, 3000, "The notes");

  const logoPath = text(input.logoPath) || null;
  if (logoPath && !imagePattern.test(logoPath)) errors.logoPath = "Upload the logo again.";
  const heroPath = text(input.heroPath) || null;
  if (heroPath && !imagePattern.test(heroPath)) errors.heroPath = "Upload the image again.";
  const colors = { backgroundColor: text(input.backgroundColor), textColor: text(input.textColor), accentColor: text(input.accentColor) };
  for (const [key, value] of Object.entries(colors)) if (!colorPattern.test(value)) errors[key] = "Use a colour like #651F2C.";
  const title = text(input.title);
  limit("title", title, 80, "The title");
  const subtitle = text(input.subtitle);
  limit("subtitle", subtitle, 160, "The subtitle");

  const websiteUrl = httpsUrl(input.websiteUrl, "websiteUrl", errors, "The website");
  const landingUrl = httpsUrl(input.landingUrl, "landingUrl", errors, "The landing page");
  const discountUrl = httpsUrl(input.discountUrl, "discountUrl", errors, "The discount link");
  const qrUrl = httpsUrl(input.qrUrl, "qrUrl", errors, "The QR destination");
  const utm = { utmSource: text(input.utmSource), utmMedium: text(input.utmMedium), utmCampaign: text(input.utmCampaign) };
  for (const [key, value] of Object.entries(utm)) {
    if (!utmPattern.test(value) || value.length > (key === "utmCampaign" ? 80 : 60)) errors[key] = "Use letters, digits, _ . or - (no spaces).";
  }
  const extraOrigins: string[] = [];
  for (const line of multiline(input.extraOrigins).split(/[\n,]+/).map(item => item.trim()).filter(Boolean)) {
    try {
      const url = new URL(line);
      if (url.protocol !== "https:") throw new Error("protocol");
      extraOrigins.push(url.origin);
    } catch { errors.extraOrigins = `“${line.slice(0, 60)}” is not a https:// address.`; }
  }
  if (extraOrigins.length > 10) errors.extraOrigins = "At most 10 extra sites.";

  const googleWalletEnabled = input.googleWalletEnabled === true;
  if (googleWalletEnabled && !(discountUrl ?? landingUrl ?? websiteUrl)) errors.discountUrl = "Google Wallet needs a link to the shop (discount link, landing page or website).";
  const published = input.published === true;
  if (published && !title && !name) errors.title = "Enter the campaign title.";

  return Object.keys(errors).length ? { ok: false, errors } : {
    ok: true,
    value: {
      name, internalName, brand, slug, discountCode, discountType, discountValue, currency, shortDescription, longDescription,
      startsAt: startsAt as string, expiresAt: expiresAt as string, timezone, language, terms, internalNotes,
      logoPath, heroPath, ...colors, title, subtitle,
      showDiscountValue: input.showDiscountValue !== false, showDiscountCode: input.showDiscountCode !== false,
      websiteUrl, landingUrl, discountUrl, qrUrl, ...utm, extraOrigins: [...new Set(extraOrigins)],
      googleWalletEnabled, appleWalletEnabled: input.appleWalletEnabled === true,
      imageDownloadEnabled: input.imageDownloadEnabled !== false, emailEnabled: input.emailEnabled === true, published,
    },
  };
}
