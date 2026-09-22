import assert from "node:assert/strict";
import test from "node:test";
import { analyzeBocpImport, summarizeBocpImport } from "../lib/bocp/preview.ts";

function order(number: number, invoices = [{ seria: "AR", nr: number }]) {
  return { rec_id: number, connector: { type: "ShopifyV2" }, invoices };
}

function invoice(number: number, items: object[], extras: object = {}) {
  return { doc_series: "AR", doc_nr: number, doc_date: "2026-10-02", items, ...extras };
}

test("negative BOCP service IDs do not block a scannable product", () => {
  const result = summarizeBocpImport(
    [order(1)],
    [invoice(1, [
      { product_variant_id: 10, service_id: 0, item_code: "SKU-10", qty_mu1: "2", barcode: "4006381333931" },
      { product_variant_id: 0, service_id: -1, qty_mu1: "1", barcode: "" },
    ])],
    "2026-10-01",
  );
  assert.equal(result.eligibleInvoices, 1);
  assert.equal(result.serviceLines, 1);
  assert.equal(result.scannableLines, 1);
  assert.equal(result.unknownLines, 0);
});

test("missing EAN is diagnostic in SKU mode, but empty quantity blocks", () => {
  const result = summarizeBocpImport(
    [order(1), order(2)],
    [
      invoice(1, [{ product_variant_id: 10, item_code: "SKU-10", qty_mu1: "1", barcode: "" }]),
      invoice(2, [{ product_variant_id: 20, item_code: "SKU-20", qty_mu1: "", barcode: "4006381333931" }]),
    ],
    "2026-10-01",
  );
  assert.equal(result.blockedInvoices, 1);
  assert.equal(result.missingEanLines, 1);
  assert.equal(result.invalidQuantityLines, 1);
  assert.equal(result.eligibleInvoices, 1);
});

test("an EAN with a wrong check digit does not block SKU confirmation", () => {
  const result = summarizeBocpImport(
    [order(1)],
    [invoice(1, [{ product_variant_id: 10, item_code: "SKU-10", qty_mu1: "1", barcode: "4006381333932" }])],
    "2026-10-01",
  );
  assert.equal(result.eligibleInvoices, 1);
  assert.equal(result.missingEanLines, 1);
});

test("a physical product without SKU blocks its invoice", () => {
  const result = summarizeBocpImport(
    [order(1)],
    [invoice(1, [{ product_variant_id: 10, item_code: "", qty_mu1: 1, barcode: "4006381333931" }])],
    "2026-10-01",
  );
  assert.equal(result.blockedInvoices, 1);
  assert.equal(result.missingSkuLines, 1);
  assert.equal(result.missingEanLines, 0);
});

test("a return-only invoice never appears on the picking board", () => {
  const result = summarizeBocpImport(
    [order(1)],
    [invoice(1, [{ product_variant_id: 10, item_code: "SKU-10", qty_mu1: -1, barcode: "" }])],
    "2026-10-01",
  );
  assert.equal(result.eligibleInvoices, 0);
  assert.equal(result.blockedInvoices, 1);
  assert.equal(result.noPositiveProductsInvoices, 1);
});

test("EAN exceptions contain product references, not customer details", () => {
  const result = summarizeBocpImport(
    [{ ...order(1), customer_name: "Customer secret" }],
    [invoice(1, [
      { product_variant_id: 10, qty_mu1: 1, item_code: "SKU-10", item_name_plain: "Produs test", barcode: "" },
      { product_variant_id: 10, qty_mu1: 1, item_code: "SKU-10", item_name_plain: "Produs test", barcode: "" },
    ], { customer_name: "Another secret" })],
    "2026-10-01",
  );
  assert.deepEqual(result.missingEanProducts, [{ bocpProductId: "10", sku: "SKU-10", name: "Produs test", lines: 2 }]);
  assert.equal(JSON.stringify(result).includes("secret"), false);
});

test("duplicate links, cancelled invoices and pre-launch invoices are excluded", () => {
  const result = summarizeBocpImport(
    [order(1), order(2, [{ seria: "AR", nr: 1 }]), order(3), order(4)],
    [
      invoice(1, [{ product_variant_id: 10, item_code: "SKU-10", qty_mu1: 1, barcode: "4006381333931" }]),
      invoice(3, [], { document_cancelled: "1" }),
      invoice(4, [], { doc_date: "2026-09-30" }),
    ],
    "2026-10-01",
  );
  assert.equal(result.eligibleInvoices, 1);
  assert.equal(result.duplicateLinks, 1);
  assert.equal(result.cancelledInvoices, 1);
  assert.equal(result.excludedBeforeLaunch, 1);
});

test("SKU import candidate keeps EAN optional and excludes service lines", () => {
  const { candidates } = analyzeBocpImport(
    [order(7)],
    [invoice(7, [
      { product_variant_id: 33, item_code: "AT-33", item_name_plain: "Produs test", qty_mu1: "2", barcode: "" },
      { product_variant_id: 0, service_id: -1, qty_mu1: "1", item_name_plain: "Transport" },
    ], { bocp_id: 17, client_name: "Client test", client_shipping_adress: "Strada test" })],
    "2026-10-01",
  );
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].invoiceNumber, "AR-7");
  assert.equal(candidates[0].customerName, "Client test");
  assert.equal(candidates[0].items.length, 1);
  assert.deepEqual(candidates[0].items[0], {
    bocpProductId: "33", sku: "AT-33", name: "Produs test", ean: null, quantity: 2,
  });
});
