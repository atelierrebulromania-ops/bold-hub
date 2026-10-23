import assert from "node:assert/strict";
import test from "node:test";
import { cleanDomains, cleanFileName, detectKind, expiryFrom, matchSupplier, periodFor, sha256Hex } from "../lib/accounting/files.ts";

const text = (value: string) => new TextEncoder().encode(value);
const xlsx = () => new Uint8Array([0x50, 0x4b, 0x03, 0x04, ...text("....[Content_Types].xml....")]);

test("a PDF is accepted only when its bytes are a PDF", () => {
  assert.deepEqual(detectKind(text("%PDF-1.7\n..."), "factura.pdf"), { ok: true, kind: "pdf", mime: "application/pdf" });
  assert.equal(detectKind(text("\n\n%PDF-1.4"), "factura.PDF").ok, true);
  assert.equal(detectKind(text("<html>not a pdf</html>"), "factura.pdf").ok, false);
  assert.equal(detectKind(xlsx(), "factura.pdf").ok, false);
});

test("an XLSX needs the zip header and the Office content types", () => {
  assert.equal(detectKind(xlsx(), "raport.xlsx").ok, true);
  assert.equal(detectKind(new Uint8Array([0x50, 0x4b, 0x03, 0x04, 1, 2, 3]), "raport.xlsx").ok, false);
});

test("a CSV must be UTF-8 text without binary bytes", () => {
  assert.equal(detectKind(text("data,suma\n2026-10-01,12.50\n"), "payouts.csv").ok, true);
  assert.equal(detectKind(text("ăîșț,ţ\n"), "payouts.csv").ok, true);
  assert.equal(detectKind(new Uint8Array([0x61, 0x00, 0x62]), "payouts.csv").ok, false);
  assert.equal(detectKind(new Uint8Array([0xff, 0xfe, 0x41]), "payouts.csv").ok, false);
});

test("other extensions, empty and oversized files are refused", () => {
  assert.equal(detectKind(text("%PDF-1.7"), "factura.exe").ok, false);
  assert.equal(detectKind(text("%PDF-1.7"), "factura.pdf.zip").ok, false);
  assert.equal(detectKind(new Uint8Array(), "factura.pdf").ok, false);
  const big = new Uint8Array(25 * 1024 * 1024 + 1);
  big.set(text("%PDF-1.7"));
  assert.equal(detectKind(big, "factura.pdf").ok, false);
});

test("the supplier is found by domain or subdomain, longest match first", () => {
  const suppliers = [
    { id: "1", slug: "shopify_billing", name: "Shopify Billing", domains: ["shopify.com"] },
    { id: "2", slug: "shopify_payouts", name: "Shopify Payouts", domains: ["admin.shopify.com"] },
    { id: "3", slug: "meta_ads", name: "Meta Ads", domains: ["facebook.com", "business.facebook.com"] },
  ];
  assert.equal(matchSupplier("admin.shopify.com", suppliers)?.slug, "shopify_payouts");
  assert.equal(matchSupplier("partners.shopify.com", suppliers)?.slug, "shopify_billing");
  assert.equal(matchSupplier("BUSINESS.facebook.com.", suppliers)?.slug, "meta_ads");
  assert.equal(matchSupplier("notfacebook.com", suppliers), null);
  assert.equal(matchSupplier("facebook.com.evil.ro", suppliers), null);
});

test("the period is the given month, else the issue month, else the Bucharest month of collection", () => {
  const collected = new Date("2026-10-31T22:30:00Z"); // already 1 November in Bucharest
  assert.equal(periodFor("2026-09", "2026-08-15", collected), "2026-09");
  assert.equal(periodFor(null, "2026-08-15", collected), "2026-08");
  assert.equal(periodFor("2026-13", "2026-02-30", collected), "2026-11");
});

test("files expire exactly 30 days after collection", () => {
  assert.equal(expiryFrom(new Date("2026-10-23T10:00:00Z")).toISOString(), "2026-11-22T10:00:00.000Z");
});

test("domains typed by the admin are cleaned and deduplicated", () => {
  assert.deepEqual(cleanDomains(["https://Ads.Google.com/aw/billing", "ads.google.com", "not a domain", "localhost", " tiktok.com "]), ["ads.google.com", "tiktok.com"]);
});

test("file names lose paths and control characters", () => {
  assert.equal(cleanFileName("../../etc/Factura:1?.pdf"), "Factura1.pdf");
  assert.equal(cleanFileName("C:\\Users\\x\\inv\u0007.pdf"), "inv.pdf");
});

test("the same bytes always hash the same (duplicate detection)", async () => {
  assert.equal(await sha256Hex(text("abc")), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  assert.notEqual(await sha256Hex(text("abc ")), await sha256Hex(text("abc")));
});
