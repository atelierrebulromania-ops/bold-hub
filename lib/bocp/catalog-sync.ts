import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { parseBocpCatalog } from "@/lib/bocp/catalog";
import { bocpGetList } from "@/lib/bocp/client";
import type { Database, Json } from "@/lib/database.types";
import { createAdminClient } from "@/lib/supabase/admin";

const MAX_CATALOG_PAGES = 30;

export type CatalogSyncResult =
  | { ok: true; total: number; withEan: number; created: number; eanSet: number; stockSet: number; flagged: string[] }
  | { ok: false; error: "bocp_unreachable" | "catalog_too_large" | "save_failed" };

// Reads the whole BOCP catalog (read-only GETs) and applies products, prices, EANs and stock. Used by Admin →
// Catalog (as the admin) and by the scheduled job (service role). A partial catalog is never applied.
export async function syncCatalogFromBocp(supabase: SupabaseClient<Database>): Promise<CatalogSyncResult> {
  const rows: unknown[] = [];
  let page: number | null = 1;
  try {
    for (let fetched = 0; page !== null && fetched < MAX_CATALOG_PAGES; fetched++) {
      // With the pictures: the agents' catalog shows them.
      const result = await bocpGetList("product/list/include:images", { page });
      rows.push(...result.rows);
      page = result.nextPage;
    }
  } catch {
    return { ok: false, error: "bocp_unreachable" };
  }
  if (page !== null) return { ok: false, error: "catalog_too_large" };

  const { products, summary } = parseBocpCatalog(rows);
  let created = 0, eanSet = 0, stockSet = 0;
  const conflicts: string[] = [];
  for (let index = 0; index < products.length; index += 500) {
    const { data, error } = await supabase.rpc("sync_bocp_catalog", { p_products: products.slice(index, index + 500) as unknown as Json });
    if (error || !data) return { ok: false, error: "save_failed" };
    const result = data as { created: number; eanSet: number; stockSet: number; eanConflicts: { sku: string }[] };
    created += result.created;
    eanSet += result.eanSet;
    stockSet += result.stockSet;
    conflicts.push(...result.eanConflicts.map((conflict) => conflict.sku));
  }
  // When the catalog last came from BOCP (shown next to the stock in the agents' catalog).
  await createAdminClient()?.from("app_settings").update({ catalog_synced_at: new Date().toISOString() }).eq("id", 1);
  const flagged = [...summary.duplicateEan.flatMap((entry) => entry.skus), ...summary.invalidEan.map((entry) => entry.sku), ...conflicts];
  return { ok: true, total: summary.activeProducts, withEan: summary.withEan, created, eanSet, stockSet, flagged };
}
