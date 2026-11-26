// Google Wallet Offers: the OfferClass and OfferObject built from a voucher, and the Add to Google Wallet JWT
// claims. Pure, so the tests check exactly what is sent to Google.
//
// One code for everyone: each campaign has ONE class and ONE shared object. The class allows
// MULTIPLE_HOLDERS, so the same object can be saved by any number of people on any number of devices, and
// an update to the voucher reaches every saved copy. No single-use redemption.
import { createSign } from "node:crypto";
import { benefitLabel, shopUrl, validityLabel, voucherLabels, walletUtm, zonedIso, type Voucher } from "./voucher.ts";

export type WalletIds = { classId: string; objectId: string };

const idPart = /[^A-Za-z0-9._-]/g;

// Google ids are "<issuer id>.<identifier>". The identifier comes from the slug plus the first 8 characters of
// the voucher id, and is stored at the first sync: renaming the slug later does not create a new class.
export function googleWalletIds(issuerId: string, voucher: Pick<Voucher, "id" | "slug">, stored?: Partial<WalletIds>): WalletIds {
  const base = `${voucher.slug}-${voucher.id.slice(0, 8)}`.replace(idPart, "-");
  return {
    classId: stored?.classId ?? `${issuerId}.${base}`,
    objectId: stored?.objectId ?? `${issuerId}.${base}-shared`,
  };
}

const localized = (value: string, language: string) => ({ defaultValue: { language, value } });
const image = (uri: string, description: string, language: string) => ({ sourceUri: { uri }, contentDescription: localized(description, language) });

export function offerClass(voucher: Voucher, ids: WalletIds, assetUrl: (path: string) => string) {
  // The subtitle and descriptions make the "details" text of the pass.
  const details = [voucher.subtitle, voucher.short_description, voucher.long_description].filter(Boolean).join("\n\n");
  return {
    id: ids.classId,
    issuerName: voucher.brand,
    provider: voucher.brand,
    title: voucher.title || voucher.name,
    redemptionChannel: "ONLINE",
    // Required on insert and on every update of an offer class.
    reviewStatus: "UNDER_REVIEW",
    multipleDevicesAndHoldersAllowedStatus: "MULTIPLE_HOLDERS",
    hexBackgroundColor: voucher.background_color,
    ...(details ? { details } : {}),
    ...(voucher.terms ? { finePrint: voucher.terms } : {}),
    ...(voucher.website_url ? { homepageUri: { uri: voucher.website_url, description: voucher.brand } } : {}),
    ...(voucher.logo_path ? { titleImage: image(assetUrl(voucher.logo_path), voucher.brand, voucher.language) } : {}),
    ...(voucher.hero_path ? { heroImage: image(assetUrl(voucher.hero_path), voucher.title || voucher.name, voucher.language) } : {}),
    localizedIssuerName: localized(voucher.brand, voucher.language),
  };
}

export function offerObject(voucher: Voucher, ids: WalletIds) {
  const labels = voucherLabels[voucher.language];
  const shop = shopUrl(voucher, walletUtm(voucher, "google_wallet"));
  const modules = [
    ...(voucher.show_discount_value ? [{ id: "benefit", header: labels.benefit, body: `${benefitLabel(voucher)} ${labels.discount}` }] : []),
    ...(voucher.show_discount_code ? [{ id: "code", header: labels.code, body: voucher.discount_code }] : []),
    { id: "validity", header: labels.validity, body: validityLabel(voucher) },
  ];
  return {
    id: ids.objectId,
    classId: ids.classId,
    state: "ACTIVE",
    // Before the start the pass can already be saved; after the end Google moves it to the expired passes.
    validTimeInterval: {
      start: { date: zonedIso(voucher.starts_at, voucher.timezone) },
      end: { date: zonedIso(voucher.expires_at, voucher.timezone) },
    },
    textModulesData: modules,
    ...(shop ? { linksModuleData: { uris: [{ id: "shop", uri: shop, description: labels.shop }] } } : {}),
    // The code under a QR that opens the shop with the code applied.
    ...(voucher.show_discount_code && shop ? { barcode: { type: "QR_CODE", value: shop, alternateText: voucher.discount_code } } : {}),
  };
}

// Claims of the "Add to Google Wallet" JWT. The object already exists (created over REST), so the JWT only
// names it; Google adds that same shared object to whoever opens the link.
export function saveClaims(serviceAccountEmail: string, ids: WalletIds, origins: string[], now = Date.now()) {
  return {
    iss: serviceAccountEmail,
    aud: "google",
    typ: "savetowallet",
    iat: Math.floor(now / 1000),
    origins,
    payload: { offerObjects: [{ id: ids.objectId, classId: ids.classId }] },
  };
}

export const saveUrlPrefix = "https://pay.google.com/gp/v/save/";

const base64url = (value: string | Buffer) => Buffer.from(value).toString("base64url");

// RS256 JWT, signed with the service account's private key (server only: the key never reaches a browser).
export function signJwt(claims: object, privateKey: string) {
  const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const body = base64url(JSON.stringify(claims));
  const signature = createSign("RSA-SHA256").update(`${header}.${body}`).sign(privateKey);
  return `${header}.${body}.${base64url(signature)}`;
}
