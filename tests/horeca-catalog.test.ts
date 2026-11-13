import assert from "node:assert/strict";
import test from "node:test";
import { cardsPerPage, discountedPrice, formatPercent, formatPrice, formatSize, pdfFileName, planCatalog, termsOf, type CatalogData, type CatalogProduct } from "../lib/horeca/catalog.ts";

function catalog(counts: number[], overrides: Partial<CatalogData> = {}): CatalogData {
  const collections = counts.map((_, index) => ({ id: `c${index}`, label: "COLECCIÓN SIGNATURE", name: `C${index}`, position: index, active: true }));
  const products: CatalogProduct[] = counts.flatMap((count, index) => Array.from({ length: count }, (_, n) => ({
    id: `p${index}-${n}`, collection_id: `c${index}`, name: `Produs ${n}`, price: 6.59, currency: null,
    size_value: 550, size_unit: "ml" as const, sku: `AT${n}`, image_path: null, position: n, active: true,
  })));
  return {
    id: "x", title: "T", language: "es", currency: "EUR", cover_title: "HO RE CA", cover_subtitle: "LISTA DE PRECIOS",
    website: "www.atelierrebul.ro", terms_vat: "IVA", terms_currency: null, terms_payment: " Pago ", terms_delivery: "", terms_other: null, discount_percent: 0,
    collections, products, ...overrides,
  };
}

const productPages = (plan: ReturnType<typeof planCatalog>) => plan.filter(page => page.kind === "products");

test("the reference layout: cover, terms, then a title page and one product page per collection, back page", () => {
  const plan = planCatalog(catalog([5, 5, 5]));
  assert.deepEqual(plan.map(page => page.kind), ["cover", "terms", "collection", "products", "collection", "products", "collection", "products", "back"]);
  const first = productPages(plan)[0];
  assert.ok(first.kind === "products");
  assert.deepEqual(first.rows.map(row => row.length), [2, 2, 1]);
});

test("cards never split: more products than fit go to continuation pages", () => {
  const plan = planCatalog(catalog([cardsPerPage * 2 + 3]));
  const pages = productPages(plan);
  assert.equal(pages.length, 3);
  assert.deepEqual(pages.map(page => page.kind === "products" && page.rows.flat().length), [cardsPerPage, cardsPerPage, 3]);
  assert.deepEqual(pages.map(page => page.kind === "products" && page.continued), [false, true, true]);
});

test("exactly full pages leave no empty extra page", () => {
  assert.equal(productPages(planCatalog(catalog([cardsPerPage]))).length, 1);
  assert.equal(productPages(planCatalog(catalog([cardsPerPage * 3]))).length, 3);
});

test("inactive products and collections, and empty collections, are left out", () => {
  const data = catalog([3, 2, 0]);
  data.products[0].active = false;
  data.collections[1].active = false;
  const plan = planCatalog(data);
  assert.deepEqual(plan.map(page => page.kind), ["cover", "terms", "collection", "products", "back"]);
  const page = productPages(plan)[0];
  assert.ok(page.kind === "products");
  assert.equal(page.rows.flat().length, 2);
});

test("collections and products follow their display order", () => {
  const data = catalog([2, 2]);
  data.collections[0].position = 5;
  data.products[0].position = 9;
  const plan = planCatalog(data);
  const collections = plan.filter(page => page.kind === "collection").map(page => page.kind === "collection" && page.collection.id);
  assert.deepEqual(collections, ["c1", "c0"]);
  const last = productPages(plan)[1];
  assert.ok(last.kind === "products");
  assert.deepEqual(last.rows.flat().map(product => product.id), ["p0-1", "p0-0"]);
});

test("formatting as in the reference catalog", () => {
  assert.equal(formatPrice(6.59, "EUR"), "6.59€");
  assert.equal(formatPrice(6.5, "EUR"), "6.50€");
  assert.equal(formatPrice(32, "RON"), "32.00 LEI");
  assert.equal(formatPrice(9.9, "USD"), "$9.90");
  assert.equal(formatSize(550, "ml"), "550ML");
  assert.equal(formatSize(0.5, "kg"), "0.5KG");
  assert.equal(formatSize(6, "buc"), "6 BUC.");
  assert.equal(formatSize(null, null), null);
  assert.equal(pdfFileName("es", new Date("2026-11-10T10:00:00Z")), "Atelier_Rebul_HoReCa_ES_2026-11-10.pdf");
  assert.deepEqual(termsOf(catalog([1])), ["IVA", "Pago"]);
});

test("catalog discount: rounded to cents, 0 leaves the price as it is", async () => {
  assert.equal(discountedPrice(6.59, 10), 5.93);
  assert.equal(discountedPrice(62.7, 15), 53.3);
  assert.equal(discountedPrice(111.92, 12.5), 97.93);
  assert.equal(discountedPrice(1.07, 0), 1.07);
  assert.equal(formatPrice(discountedPrice(6.59, 10), "EUR"), "5.93€");
  assert.equal(formatPercent(10), "10%");
  assert.equal(formatPercent(12.5), "12.5%");
  const { parseCatalogInfo } = await import("../lib/horeca/validate.ts");
  const base = { title: "T", language: "es", currency: "EUR" };
  const ok = parseCatalogInfo({ ...base, discountPercent: "12,5" });
  assert.ok(ok.ok && ok.value.discountPercent === 12.5);
  const none = parseCatalogInfo({ ...base, discountPercent: "" });
  assert.ok(none.ok && none.value.discountPercent === 0);
  for (const bad of ["100", "-5", "zece"]) assert.ok(!parseCatalogInfo({ ...base, discountPercent: bad }).ok, bad);
});

test("product fields are validated with plain messages", async () => {
  const { parseProduct, parseAmount } = await import("../lib/horeca/validate.ts");
  assert.equal(parseAmount("6,59"), 6.59);
  assert.equal(parseAmount("1 250.5"), 1250.5);
  assert.equal(parseAmount("6.599"), null);
  assert.equal(parseAmount("abc"), null);
  const ok = parseProduct({ name: "  Champú   1895 ", collectionId: "0d0e9a9c-0000-4000-8000-000000000001", price: "6,59", sizeValue: "550", sizeUnit: "ml", sku: " AT03661 " });
  assert.ok(ok.ok);
  if (ok.ok) assert.deepEqual([ok.value.name, ok.value.price, ok.value.sizeValue, ok.value.sizeUnit, ok.value.sku, ok.value.currency], ["Champú 1895", 6.59, 550, "ml", "AT03661", null]);
  const bad = parseProduct({ name: "", collectionId: "x", price: "", sizeValue: "550", sizeUnit: "" });
  assert.ok(!bad.ok);
  if (!bad.ok) assert.deepEqual(Object.keys(bad.errors).sort(), ["collectionId", "name", "price", "sizeUnit"]);
});
