import assert from "node:assert/strict";
import { createVerify, generateKeyPairSync } from "node:crypto";
import test from "node:test";
import { googleWalletIds, offerClass, offerObject, saveClaims, signJwt } from "../lib/vouchers/google-payload.ts";
import { parseVoucher, slugify } from "../lib/vouchers/validate.ts";
import {
  allowedOrigins, benefitLabel, clientEventTypes, deviceType, qrDestination, referrerHost, shopUrl, campaignUtm, utcToZoned,
  validityLabel, voucherStatus, walletUtm, withUtm, zonedIso, zonedToUtc, type Voucher,
} from "../lib/vouchers/voucher.ts";

// The first campaign, exactly as briefed.
const gift: Voucher = {
  id: "0f6a3c1e-1111-4222-8333-944455556666", name: "Atelier Rebul – Private Gift", internal_name: "December 2026 Event Voucher",
  brand: "Atelier Rebul", slug: "private-gift", discount_code: "GIFT25", discount_type: "percentage", discount_value: 25, currency: null,
  short_description: "", long_description: "Bucură-te de 25% reducere la produsele tale preferate Atelier Rebul, pe tot parcursul lunii decembrie.",
  starts_at: "2026-11-30T22:00:00.000Z", expires_at: "2026-12-31T21:59:59.000Z", timezone: "Europe/Bucharest", language: "ro",
  terms: "Voucher valabil exclusiv online…", internal_notes: "", logo_path: "vouchers/aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee.png", hero_path: null,
  background_color: "#651F2C", text_color: "#F5EEE4", accent_color: "#D8BE98", title: "Un cadou pentru tine",
  subtitle: "Bucuria de a dărui începe cu un cadou pentru tine.", show_discount_value: true, show_discount_code: true,
  website_url: "https://atelierrebul.ro", landing_url: "https://atelierrebul.ro/pages/private-gift",
  discount_url: "https://atelierrebul.ro/discount/GIFT25?redirect=/collections/all", qr_url: "https://atelierrebul.ro/pages/private-gift",
  utm_source: "event", utm_medium: "qr", utm_campaign: "private_gift_december_2026", extra_origins: [],
  google_wallet_enabled: true, apple_wallet_enabled: false, image_download_enabled: true, email_enabled: false,
  published: true, archived_at: null, created_at: "2026-11-26T10:00:00Z", updated_at: "2026-11-26T10:00:00Z",
};

test("dates typed in Europe/Bucharest become the right instants (winter and summer time)", () => {
  assert.equal(zonedToUtc("2026-12-01T00:00:00", "Europe/Bucharest"), "2026-11-30T22:00:00.000Z");
  assert.equal(zonedToUtc("2026-12-31T23:59:59", "Europe/Bucharest"), "2026-12-31T21:59:59.000Z");
  assert.equal(zonedToUtc("2027-07-01T00:00", "Europe/Bucharest"), "2027-06-30T21:00:00.000Z");
  assert.equal(zonedToUtc("2026-02-30T00:00", "Europe/Bucharest"), null);
  assert.equal(zonedToUtc("01.12.2026", "Europe/Bucharest"), null);
  assert.equal(utcToZoned(gift.starts_at, gift.timezone), "2026-12-01T00:00:00");
  assert.equal(zonedIso(gift.starts_at, gift.timezone), "2026-12-01T00:00:00+02:00");
  assert.equal(zonedIso(gift.expires_at, gift.timezone), "2026-12-31T23:59:59+02:00");
  assert.equal(validityLabel(gift), "01.12.2026 – 31.12.2026");
});

test("status follows the dates; draft and archived win", () => {
  assert.equal(voucherStatus(gift, new Date("2026-11-27T12:00:00Z")), "scheduled");
  // 1 December 00:00 Bucharest is 30 November 22:00 UTC.
  assert.equal(voucherStatus(gift, new Date("2026-11-30T21:59:59Z")), "scheduled");
  assert.equal(voucherStatus(gift, new Date("2026-11-30T22:00:00Z")), "active");
  assert.equal(voucherStatus(gift, new Date("2026-12-31T21:59:59Z")), "active");
  assert.equal(voucherStatus(gift, new Date("2026-12-31T22:00:00Z")), "expired");
  assert.equal(voucherStatus({ ...gift, published: false }, new Date("2026-12-10T12:00:00Z")), "draft");
  assert.equal(voucherStatus({ ...gift, archived_at: "2026-12-05T00:00:00Z" }, new Date("2026-12-10T12:00:00Z")), "archived");
});

test("links: UTM tags go on the page the Shopify discount link redirects to", () => {
  assert.equal(shopUrl(gift, campaignUtm(gift)),
    "https://atelierrebul.ro/discount/GIFT25?redirect=%2Fcollections%2Fall%3Futm_source%3Devent%26utm_medium%3Dqr%26utm_campaign%3Dprivate_gift_december_2026");
  const target = new URL(new URL(shopUrl(gift, walletUtm(gift, "google_wallet"))!).searchParams.get("redirect")!, "https://x");
  assert.equal(target.pathname, "/collections/all");
  assert.equal(target.searchParams.get("utm_source"), "google_wallet");
  assert.equal(qrDestination(gift), "https://atelierrebul.ro/pages/private-gift?utm_source=event&utm_medium=qr&utm_campaign=private_gift_december_2026");
  assert.equal(withUtm("https://a.ro/x", { source: "", medium: "", campaign: "" }), "https://a.ro/x");
  assert.equal(benefitLabel(gift), "25%");
  assert.equal(benefitLabel({ discount_type: "fixed_amount", discount_value: 50, currency: "RON" }), "50 lei");
});

test("CORS: only the campaign's own sites, with and without www", () => {
  const origins = allowedOrigins(gift);
  assert.deepEqual(origins.sort(), ["https://atelierrebul.ro", "https://www.atelierrebul.ro"]);
  assert.ok(allowedOrigins({ ...gift, extra_origins: ["https://atelier-rebul.myshopify.com"] }).includes("https://atelier-rebul.myshopify.com"));
  assert.ok(!origins.includes("https://evil.example"));
});

test("analytics helpers keep nothing personal", () => {
  assert.equal(deviceType("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)"), "mobile");
  assert.equal(deviceType("Mozilla/5.0 (Linux; Android 15; Pixel 9) Mobile"), "mobile");
  assert.equal(deviceType("Mozilla/5.0 (iPad; CPU OS 18_0)"), "tablet");
  assert.equal(deviceType("Mozilla/5.0 (Macintosh; Intel Mac OS X 15_0)"), "desktop");
  assert.equal(deviceType(null), "unknown");
  assert.equal(referrerHost("https://l.instagram.com/?u=https%3A%2F%2Fatelierrebul.ro&e=secret"), "l.instagram.com");
  assert.equal(referrerHost("not a url"), null);
  // Wallet and e-mail events can only be written by the server.
  assert.ok(!clientEventTypes.includes("google_wallet_link_generated"));
  assert.ok(!clientEventTypes.includes("email_voucher_sent"));
});

const formInput = {
  name: "Atelier Rebul – Private Gift", internalName: "December 2026 Event Voucher", brand: "Atelier Rebul", slug: "private-gift",
  discountCode: "gift25", discountType: "percentage", discountValue: "25", startsAt: "2026-12-01T00:00:00", expiresAt: "2026-12-31T23:59:59",
  timezone: "Europe/Bucharest", language: "ro", backgroundColor: "#651F2C", textColor: "#F5EEE4", accentColor: "#D8BE98",
  title: "Un cadou pentru tine", websiteUrl: "https://atelierrebul.ro", discountUrl: "https://atelierrebul.ro/discount/GIFT25?redirect=/collections/all",
  utmSource: "event", utmMedium: "qr", utmCampaign: "private_gift_december_2026", googleWalletEnabled: true, published: true,
};

test("the form is validated on the server with plain messages", () => {
  const ok = parseVoucher(formInput);
  assert.ok(ok.ok);
  if (ok.ok) {
    assert.equal(ok.value.discountCode, "GIFT25");
    assert.equal(ok.value.startsAt, "2026-11-30T22:00:00.000Z");
    assert.equal(ok.value.currency, null);
    assert.equal(ok.value.appleWalletEnabled, false);
  }
  const bad = parseVoucher({ ...formInput, slug: "Private Gift", discountValue: "125", expiresAt: "2026-11-01T00:00", websiteUrl: "http://atelierrebul.ro", backgroundColor: "red", utmSource: "has space" });
  assert.ok(!bad.ok);
  if (!bad.ok) assert.deepEqual(Object.keys(bad.errors).sort(), ["backgroundColor", "discountValue", "expiresAt", "slug", "utmSource", "websiteUrl"]);
  const fixed = parseVoucher({ ...formInput, discountType: "fixed_amount", discountValue: "50" });
  assert.ok(!fixed.ok && "currency" in fixed.errors);
  assert.equal(slugify("Atelier Rebul – Private Gift!"), "atelier-rebul-private-gift");
});

test("Google Wallet: one class and one shared object, ids from the issuer, reusable by many holders", () => {
  const ids = googleWalletIds("3388000000023234838", gift);
  assert.equal(ids.classId, "3388000000023234838.private-gift-0f6a3c1e");
  assert.equal(ids.objectId, "3388000000023234838.private-gift-0f6a3c1e-shared");
  // Stored ids win, so renaming the slug does not create new resources.
  assert.deepEqual(googleWalletIds("3388000000023234838", { ...gift, slug: "renamed" }, ids), ids);

  const cls = offerClass(gift, ids, path => `https://cdn.example/${path}`);
  assert.equal(cls.id, ids.classId);
  assert.equal(cls.issuerName, "Atelier Rebul");
  assert.equal(cls.redemptionChannel, "ONLINE");
  assert.equal(cls.reviewStatus, "UNDER_REVIEW");
  assert.equal(cls.multipleDevicesAndHoldersAllowedStatus, "MULTIPLE_HOLDERS");
  assert.equal(cls.hexBackgroundColor, "#651F2C");
  assert.equal(cls.titleImage?.sourceUri.uri, "https://cdn.example/vouchers/aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee.png");
  assert.equal(cls.finePrint, gift.terms);

  const object = offerObject(gift, ids);
  assert.equal(object.state, "ACTIVE");
  assert.deepEqual(object.validTimeInterval, { start: { date: "2026-12-01T00:00:00+02:00" }, end: { date: "2026-12-31T23:59:59+02:00" } });
  assert.deepEqual(object.textModulesData.map(module => [module.header, module.body]), [
    ["Beneficiu", "25% reducere"], ["Cod de reducere", "GIFT25"], ["Valabilitate", "01.12.2026 – 31.12.2026"],
  ]);
  assert.equal(object.barcode?.alternateText, "GIFT25");
  assert.ok(object.linksModuleData?.uris[0].uri.includes("utm_source%3Dgoogle_wallet"));
  // No single-use redemption.
  assert.ok(!("redemptionIssuers" in cls) && !("smartTapRedemptionValue" in object));
  const hidden = offerObject({ ...gift, show_discount_code: false }, ids);
  assert.ok(!hidden.barcode && !hidden.textModulesData.some(module => module.body === "GIFT25"));
});

test("the Add to Google Wallet JWT is RS256 and only names the shared object", () => {
  const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const ids = googleWalletIds("3388000000023234838", gift);
  const claims = saveClaims("wallet@example.iam.gserviceaccount.com", ids, ["https://atelierrebul.ro"], Date.UTC(2026, 10, 26));
  const jwt = signJwt(claims, privateKey.export({ type: "pkcs8", format: "pem" }).toString());
  const [header, body, signature] = jwt.split(".");
  assert.deepEqual(JSON.parse(Buffer.from(header, "base64url").toString()), { alg: "RS256", typ: "JWT" });
  const payload = JSON.parse(Buffer.from(body, "base64url").toString());
  assert.equal(payload.aud, "google");
  assert.equal(payload.typ, "savetowallet");
  assert.deepEqual(payload.payload, { offerObjects: [{ id: ids.objectId, classId: ids.classId }] });
  assert.ok(createVerify("RSA-SHA256").update(`${header}.${body}`).verify(publicKey, Buffer.from(signature, "base64url")));
  // The private key is never part of the token.
  assert.ok(!jwt.includes("PRIVATE"));
});
