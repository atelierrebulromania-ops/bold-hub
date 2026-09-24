/** Preview diagnostics. Never return BOCP customer or document records to the browser. */

type DataRecord = Record<string, unknown>;

export type BocpMissingEanProduct = {
  bocpProductId: string;
  sku: string;
  name: string;
  lines: number;
};

export type BocpImportCandidate = {
  invoiceNumber: string;
  bocpInvoiceId: string;
  bocpOrderId: string;
  source: "shopify" | "marketplace";
  customerName: string | null;
  customerPhone: string | null;
  customerEmail: string | null;
  shippingAddress: string | null;
  invoicePdfUrl: string | null;
  invoiceDate: string;
  /** BOCP record time of the invoice, Bucharest wall clock ("YYYY-MM-DD HH:MM:SS"). */
  invoiceIssuedAt: string | null;
  items: { bocpProductId: string; sku: string; name: string; ean: string | null; quantity: number; gift: boolean }[];
};

export type BocpImportPreview = {
  orderRows: number;
  invoiceRows: number;
  linkedInvoices: number;
  matchedInvoices: number;
  missingInvoices: number;
  duplicateLinks: number;
  cancelledInvoices: number;
  excludedBeforeLaunch: number;
  unknownSources: number;
  eligibleInvoices: number;
  eligibleShopify: number;
  eligibleMarketplace: number;
  blockedInvoices: number;
  productLines: number;
  scannableLines: number;
  missingSkuLines: number;
  missingEanLines: number;
  invalidQuantityLines: number;
  nonpositiveQuantityLines: number;
  noPositiveProductsInvoices: number;
  serviceLines: number;
  unknownLines: number;
  missingEanProducts: BocpMissingEanProduct[];
  missingSkuProducts: BocpMissingEanProduct[];
};

function record(value: unknown): DataRecord | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as DataRecord : null;
}

function records(value: unknown): DataRecord[] {
  return Array.isArray(value) ? value.map(record).filter((item): item is DataRecord => item !== null) : [];
}

function string(value: unknown): string {
  return typeof value === "string" || typeof value === "number" ? String(value).trim() : "";
}

function positiveId(value: unknown): boolean {
  return /^\d+$/.test(string(value)) && Number(string(value)) > 0;
}

function nonzeroId(value: unknown): boolean {
  return /^-?\d+$/.test(string(value)) && Number(string(value)) !== 0;
}

function invoiceKey(series: unknown, number: unknown): string | null {
  const cleanSeries = string(series).toUpperCase();
  const cleanNumber = string(number);
  if (!cleanSeries || !/^\d+$/.test(cleanNumber)) return null;
  return `${cleanSeries}#${cleanNumber.replace(/^0+(?=\d)/, "")}`;
}

function isFlagged(value: unknown): boolean {
  return value === true || value === 1 || string(value) === "1";
}

function sourceOf(order: DataRecord): "shopify" | "marketplace" | null {
  const connectorType = string(record(order.connector)?.type);
  if (!connectorType) return null;
  return /shopify/i.test(connectorType) ? "shopify" : "marketplace";
}

export function isEan(value: unknown): boolean {
  const code = string(value);
  if (!/^(?:\d{8}|\d{12,14})$/.test(code)) return false;
  const digits = [...code].map(Number);
  const checkDigit = digits.pop();
  let total = 0;
  for (let index = digits.length - 1, weight = 3; index >= 0; index--, weight = weight === 3 ? 1 : 3) {
    total += digits[index] * weight;
  }
  return (10 - total % 10) % 10 === checkDigit;
}

function optional(value: unknown): string | null {
  return string(value) || null;
}

function pdfUrl(value: unknown): string | null {
  try {
    const url = new URL(string(value));
    return url.protocol === "https:" && url.hostname === "secure.bocp.eu" ? url.toString() : null;
  } catch { return null; }
}

// "Discount Gel de duș Lemongrass & Honey - 250ml" and "Gel de duș - Lemongrass & Honey - 250ml"
// name the same product, so compare letters and digits only.
function nameKey(value: string): string {
  return value.toLocaleLowerCase("ro").replace(/[^\p{L}\p{N}]/gu, "");
}

function lineValue(item: DataRecord): number {
  const value = Number(string(item.value_with_vat));
  return Number.isFinite(value) ? Math.round(value * 100) : 0;
}

// Shopify offers arrive as the product at full price plus a "Discount <product>" line that
// cancels it. The product is still picked once; it is only flagged as a gift.
function giftDiscounts(items: DataRecord[]): { key: string; value: number }[] {
  return items
    .filter(item => !positiveId(item.product_variant_id) && nonzeroId(item.service_id))
    .map(item => ({ name: string(item.item_name_plain || item.item_name), value: lineValue(item) }))
    .filter(line => /^discount\s/i.test(line.name) && line.value < 0)
    .map(line => ({ key: nameKey(line.name.replace(/^discount\s+/i, "")), value: -line.value }));
}

function productName(item: DataRecord): string {
  return string(item.product_current_name) || string(item.item_name_plain || item.item_name);
}

function shippingAddress(invoice: DataRecord): string | null {
  const street = string(invoice.client_shipping_adress) || string(invoice.client_address);
  const city = string(invoice.client_shipping_city) || string(invoice.client_city);
  const county = string(invoice.client_shipping_county) || string(invoice.client_county);
  const postcode = string(invoice.client_shipping_postcode) || string(invoice.client_postcode);
  const country = string(invoice.client_shipping_country) || string(invoice.client_country);
  return [street, city, county, postcode, country].filter(Boolean).join(", ") || null;
}

export function summarizeBocpImport(ordersInput: unknown[], invoicesInput: unknown[], launchDate: string): BocpImportPreview {
  return analyzeBocpImport(ordersInput, invoicesInput, launchDate).summary;
}

export function analyzeBocpImport(ordersInput: unknown[], invoicesInput: unknown[], launchDate: string): {
  summary: BocpImportPreview;
  candidates: BocpImportCandidate[];
} {
  const orders = ordersInput.map(record).filter((item): item is DataRecord => item !== null);
  const invoices = invoicesInput.map(record).filter((item): item is DataRecord => item !== null);
  const report: BocpImportPreview = {
    orderRows: orders.length,
    invoiceRows: invoices.length,
    linkedInvoices: 0,
    matchedInvoices: 0,
    missingInvoices: 0,
    duplicateLinks: 0,
    cancelledInvoices: 0,
    excludedBeforeLaunch: 0,
    unknownSources: 0,
    eligibleInvoices: 0,
    eligibleShopify: 0,
    eligibleMarketplace: 0,
    blockedInvoices: 0,
    productLines: 0,
    scannableLines: 0,
    missingSkuLines: 0,
    missingEanLines: 0,
    invalidQuantityLines: 0,
    nonpositiveQuantityLines: 0,
    noPositiveProductsInvoices: 0,
    serviceLines: 0,
    unknownLines: 0,
    missingEanProducts: [],
    missingSkuProducts: [],
  };

  const invoiceByKey = new Map<string, DataRecord>();
  const candidates: BocpImportCandidate[] = [];
  const missingEanByProduct = new Map<string, BocpMissingEanProduct>();
  const missingSkuByProduct = new Map<string, BocpMissingEanProduct>();
  for (const invoice of invoices) {
    const key = invoiceKey(invoice.doc_series, invoice.doc_nr);
    if (key) invoiceByKey.set(key, invoice);
  }

  const seen = new Set<string>();
  for (const order of orders) {
    if (isFlagged(order.deleted) || string(order.status).startsWith("VOIDED")) continue;
    for (const link of records(order.invoices)) {
      report.linkedInvoices++;
      const key = invoiceKey(link.seria, link.nr);
      if (!key || !invoiceByKey.has(key)) {
        report.missingInvoices++;
        continue;
      }
      if (seen.has(key)) {
        report.duplicateLinks++;
        continue;
      }
      seen.add(key);
      const invoice = invoiceByKey.get(key)!;
      report.matchedInvoices++;
      if (isFlagged(invoice.document_cancelled)) {
        report.cancelledInvoices++;
        continue;
      }
      if (string(invoice.doc_date).slice(0, 10) < launchDate) {
        report.excludedBeforeLaunch++;
        continue;
      }

      const source = sourceOf(order);
      if (!source) {
        report.unknownSources++;
        report.blockedInvoices++;
        continue;
      }

      let products = 0;
      let blocked = false;
      const candidateItems: BocpImportCandidate["items"] = [];
      const discounts = giftDiscounts(records(invoice.items));
      for (const item of records(invoice.items)) {
        if (positiveId(item.product_variant_id)) {
          const rawQuantity = string(item.qty_mu1);
          const quantity = Number(rawQuantity);
          if (rawQuantity && Number.isFinite(quantity) && quantity <= 0) {
            report.nonpositiveQuantityLines++;
            continue;
          }
          products++;
          report.productLines++;
          if (!Number.isSafeInteger(quantity) || quantity < 1) {
            report.invalidQuantityLines++;
            blocked = true;
          } else {
            const bocpProductId = string(item.product_variant_id);
            const product = {
              bocpProductId,
              sku: string(item.item_code).slice(0, 80),
              name: productName(item).slice(0, 120),
              lines: 1,
            };
            if (!isEan(item.barcode)) {
              report.missingEanLines++;
              const existing = missingEanByProduct.get(bocpProductId);
              if (existing) existing.lines++;
              else missingEanByProduct.set(bocpProductId, product);
            }
            if (!string(item.item_code)) {
              report.missingSkuLines++;
              const existing = missingSkuByProduct.get(bocpProductId);
              if (existing) existing.lines++;
              else missingSkuByProduct.set(bocpProductId, product);
              blocked = true;
            } else {
              report.scannableLines++;
              const key = nameKey(productName(item));
              const discount = discounts.findIndex(line => line.value === lineValue(item) && line.value > 0 && key.includes(line.key));
              if (discount >= 0) discounts.splice(discount, 1);
              candidateItems.push({
                bocpProductId,
                sku: string(item.item_code),
                name: productName(item) || string(item.item_code),
                ean: isEan(item.barcode) ? string(item.barcode) : null,
                quantity,
                gift: discount >= 0,
              });
            }
          }
        // BOCP uses negative service IDs for uncatalogued discount/shipping lines.
        } else if (nonzeroId(item.service_id)) {
          report.serviceLines++;
        } else {
          report.unknownLines++;
          blocked = true;
        }
      }

      if (!products) report.noPositiveProductsInvoices++;
      if (!products || blocked) {
        report.blockedInvoices++;
      } else {
        report.eligibleInvoices++;
        if (source === "shopify") report.eligibleShopify++;
        else report.eligibleMarketplace++;
        candidates.push({
          invoiceNumber: `${string(invoice.doc_series).toUpperCase()}-${string(invoice.doc_nr)}`,
          bocpInvoiceId: string(invoice.bocp_id),
          bocpOrderId: string(order.rec_id),
          source,
          customerName: optional(invoice.client_name),
          customerPhone: optional(invoice.client_phone1) || optional(invoice.client_phone2),
          customerEmail: optional(invoice.client_email),
          shippingAddress: shippingAddress(invoice),
          invoicePdfUrl: pdfUrl(invoice.pdf_invoice_url),
          invoiceDate: string(invoice.doc_date).slice(0, 10),
          invoiceIssuedAt: /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(string(invoice.record_ts)) ? string(invoice.record_ts) : null,
          items: candidateItems,
        });
      }
    }
  }

  report.missingEanProducts = [...missingEanByProduct.values()]
    .sort((a, b) => b.lines - a.lines || a.bocpProductId.localeCompare(b.bocpProductId));
  report.missingSkuProducts = [...missingSkuByProduct.values()]
    .sort((a, b) => b.lines - a.lines || a.bocpProductId.localeCompare(b.bocpProductId));

  return { summary: report, candidates };
}
