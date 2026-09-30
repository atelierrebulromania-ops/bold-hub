// Products sold B2B (agents, offers, proformas, partner requests): only SKUs starting with these
// prefixes. The rest of the BOCP catalog (e.g. other brands) stays for the online warehouse only.
export const B2B_SKU_PREFIXES = ["AT", "PA"] as const;

// PostgREST filter for `.or(...)`: sku starts with one of the prefixes.
export const b2bSkuFilter = B2B_SKU_PREFIXES.map((prefix) => `sku.ilike.${prefix}%`).join(",");

export function isB2bSku(sku: string) {
  const upper = sku.trim().toUpperCase();
  return B2B_SKU_PREFIXES.some((prefix) => upper.startsWith(prefix));
}

// Admin "Catalog & EAN": show only Atelier Rebul products ("ar", the default) or all of BOCP ("all").
export const catalogScopeCookie = "boldhub-catalog-scope";
