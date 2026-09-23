"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireRole } from "@/lib/auth";
import { parseBocpCatalog } from "@/lib/bocp/catalog";
import { bocpGetList } from "@/lib/bocp/client";
import type { Json } from "@/lib/database.types";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function target(form: FormData, key: "notice" | "error", code: string) {
  const params = new URLSearchParams({ [key]: code });
  const filter = form.get("filter");
  if (filter === "missing" || filter === "sku") params.set("filter", filter);
  return `/admin/catalog?${params}`;
}

function finish(form: FormData, result: string | null | undefined): never {
  revalidatePath("/admin/catalog");
  redirect(result === "saved" ? target(form, "notice", "saved") : target(form, "error", result || "save_failed"));
}

export async function saveEan(form: FormData) {
  const { supabase } = await requireRole(["admin"]);
  const productId = form.get("product_id");
  const ean = form.get("ean");
  if (typeof productId !== "string" || !uuid.test(productId) || typeof ean !== "string" || ean.length > 32) {
    redirect(target(form, "error", "invalid"));
  }
  const { data, error } = await supabase.rpc("set_product_ean", { p_product_id: productId, p_ean: ean });
  finish(form, error ? null : data);
}

export async function setMode(form: FormData) {
  const { supabase } = await requireRole(["admin"]);
  const productId = form.get("product_id");
  const mode = form.get("mode");
  if (typeof productId !== "string" || !uuid.test(productId) || (mode !== "sku" && mode !== "ean")) {
    redirect(target(form, "error", "invalid"));
  }
  const { data, error } = await supabase.rpc("set_product_scan_mode", { p_product_id: productId, p_mode: mode });
  finish(form, error ? null : data);
}

const MAX_CATALOG_PAGES = 30;

// Read-only GETs to BOCP; writes only to our catalog. Works only from the BOCP-allowlisted IP.
export async function syncCatalog(form: FormData) {
  const { supabase } = await requireRole(["admin"]);
  const rows: unknown[] = [];
  let page: number | null = 1;
  let failed = false;
  try {
    for (let fetched = 0; page !== null && fetched < MAX_CATALOG_PAGES; fetched++) {
      const result = await bocpGetList("product/list", { page });
      rows.push(...result.rows);
      page = result.nextPage;
    }
  } catch {
    failed = true;
  }
  if (failed) redirect(target(form, "error", "bocp_unreachable"));
  // Never apply a partial catalog.
  if (page !== null) redirect(target(form, "error", "catalog_too_large"));

  const { products, summary } = parseBocpCatalog(rows);
  let created = 0, eanSet = 0, stockSet = 0;
  const conflicts: string[] = [];
  for (let index = 0; index < products.length; index += 500) {
    const { data, error } = await supabase.rpc("sync_bocp_catalog", { p_products: products.slice(index, index + 500) as unknown as Json });
    if (error || !data) redirect(target(form, "error", "save_failed"));
    const result = data as { created: number; eanSet: number; stockSet: number; eanConflicts: { sku: string }[] };
    created += result.created;
    eanSet += result.eanSet;
    stockSet += result.stockSet;
    conflicts.push(...result.eanConflicts.map(conflict => conflict.sku));
  }

  revalidatePath("/admin/catalog");
  const params = new URLSearchParams({
    notice: "synced", total: String(summary.activeProducts), withEan: String(summary.withEan),
    created: String(created), eanSet: String(eanSet), stockSet: String(stockSet),
  });
  const flagged = [...summary.duplicateEan.flatMap(entry => entry.skus), ...summary.invalidEan.map(entry => entry.sku), ...conflicts];
  if (flagged.length) params.set("check", flagged.slice(0, 20).join(","));
  redirect(`/admin/catalog?${params}`);
}

export async function enableAll(form: FormData) {
  const { supabase } = await requireRole(["admin"]);
  const { data, error } = await supabase.rpc("enable_ean_for_all");
  revalidatePath("/admin/catalog");
  redirect(error ? target(form, "error", "save_failed") : target(form, "notice", `enabled_${data ?? 0}`));
}
