import assert from "node:assert/strict";
import test from "node:test";
import { parseBocpCatalog } from "../lib/bocp/catalog.ts";

const row = (sku: string, customBarcode: string, extras: object = {}) => ({
  cod_produs: sku, cod_intern: `${sku}-INT`, barcode: "1-ATEL", custom_barcode: customBarcode,
  product_name: `Produs ${sku}`, stoc_global: "12", ...extras,
});

test("the EAN comes from custom_barcode, never from the internal barcode field", () => {
  const { products, summary } = parseBocpCatalog([row("AT02276", "8691226602790")]);
  assert.equal(products[0].ean, "8691226602790");
  assert.equal(products[0].stock, 12);
  assert.equal(summary.withEan, 1);
});

test("empty, invalid and shared EANs are left empty and reported", () => {
  const { products, summary } = parseBocpCatalog([
    row("A1", ""),
    row("A2", "8691226602791"),
    row("A3", "8691226652214"),
    row("A4", "8691226652214"),
  ]);
  assert.deepEqual(products.map(product => product.ean), [null, null, null, null]);
  assert.equal(summary.missingEan, 4);
  assert.deepEqual(summary.invalidEan, [{ sku: "A2", code: "8691226602791" }]);
  assert.deepEqual(summary.duplicateEan, [{ ean: "8691226652214", skus: ["A3", "A4"] }]);
});

test("deleted, archived and SKU-less rows are skipped", () => {
  const { products } = parseBocpCatalog([
    row("A1", "8691226602790", { is_deleted: "1" }),
    row("A2", "8691226602790", { is_archived: 1 }),
    row("", "8691226602790"),
    row("A3", "", { stoc_global: "" }),
  ]);
  assert.deepEqual(products, [{ sku: "A3", name: "Produs A3", ean: null, stock: null }]);
});
