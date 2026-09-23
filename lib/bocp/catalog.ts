// BOCP catalog (product/list): the EAN printed on the label lives in `custom_barcode`
// ("Cod bare" in BOCP); `barcode` holds the internal code (e.g. "1-ATEL") and "Cod EAN" is unused.
import { isEan } from "./preview.ts";

type DataRecord = Record<string, unknown>;

export type BocpCatalogProduct = { sku: string; name: string; ean: string | null; stock: number | null };

export type BocpCatalogSummary = {
  activeProducts: number;
  withEan: number;
  missingEan: number;
  invalidEan: { sku: string; code: string }[];
  duplicateEan: { ean: string; skus: string[] }[];
};

function text(value: unknown): string {
  return typeof value === "string" || typeof value === "number" ? String(value).trim() : "";
}

function flagged(value: unknown): boolean {
  return value === true || value === 1 || text(value) === "1";
}

export function parseBocpCatalog(rows: unknown[]): { products: BocpCatalogProduct[]; summary: BocpCatalogSummary } {
  const active = rows
    .filter((row): row is DataRecord => row !== null && typeof row === "object" && !Array.isArray(row))
    .filter(row => !flagged(row.is_deleted) && !flagged(row.deleted) && !flagged(row.is_archived) && !flagged(row.delistat))
    .filter(row => text(row.cod_produs).length > 0 && text(row.cod_produs).length <= 100);

  const invalidEan: BocpCatalogSummary["invalidEan"] = [];
  const skusByEan = new Map<string, string[]>();
  for (const row of active) {
    const code = text(row.custom_barcode);
    if (!code) continue;
    if (!isEan(code)) invalidEan.push({ sku: text(row.cod_produs), code });
    else skusByEan.set(code, [...(skusByEan.get(code) ?? []), text(row.cod_produs)]);
  }
  // An EAN shared by two SKUs cannot identify a product at scanning time; leave both without one.
  const duplicateEan = [...skusByEan.entries()].filter(([, skus]) => skus.length > 1).map(([ean, skus]) => ({ ean, skus }));
  const ambiguous = new Set(duplicateEan.map(entry => entry.ean));

  const products = active.map(row => {
    const code = text(row.custom_barcode);
    const stock = Number(text(row.stoc_global));
    return {
      sku: text(row.cod_produs),
      name: (text(row.product_name) || text(row.cod_produs)).slice(0, 300),
      ean: isEan(code) && !ambiguous.has(code) ? code : null,
      stock: text(row.stoc_global) !== "" && Number.isFinite(stock) ? Math.max(0, Math.floor(stock)) : null,
    };
  });

  const withEan = products.filter(product => product.ean).length;
  return {
    products,
    summary: { activeProducts: products.length, withEan, missingEan: products.length - withEan, invalidEan, duplicateEan },
  };
}
