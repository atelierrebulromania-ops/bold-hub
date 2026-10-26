"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { requireRole } from "@/lib/auth";
import { syncCatalogFromBocp } from "@/lib/bocp/catalog-sync";
import { catalogScopeCookie } from "@/lib/b2b-products";

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

// Read-only GETs to BOCP; writes only to our catalog. The same sync also runs every 15 minutes (cron).
export async function syncCatalog(form: FormData) {
  const { supabase } = await requireRole(["admin"]);
  const result = await syncCatalogFromBocp(supabase);
  if (!result.ok) redirect(target(form, "error", result.error));

  revalidatePath("/admin/catalog");
  const params = new URLSearchParams({
    notice: "synced", total: String(result.total), withEan: String(result.withEan),
    created: String(result.created), eanSet: String(result.eanSet), stockSet: String(result.stockSet),
  });
  if (result.flagged.length) params.set("check", result.flagged.slice(0, 20).join(","));
  redirect(`/admin/catalog?${params}`);
}

export async function enableAll(form: FormData) {
  const { supabase } = await requireRole(["admin"]);
  const { data, error } = await supabase.rpc("enable_ean_for_all");
  revalidatePath("/admin/catalog");
  redirect(error ? target(form, "error", "save_failed") : target(form, "notice", `enabled_${data ?? 0}`));
}

// Which products the admin catalog shows: only Atelier Rebul ones (B2B SKUs) or all of BOCP.
// Remembered in a cookie, so it stays after syncing or saving.
export async function setCatalogScope(form: FormData) {
  await requireRole(["admin"]);
  const scope = form.get("scope") === "all" ? "all" : "ar";
  (await cookies()).set(catalogScopeCookie, scope, { path: "/admin/catalog", maxAge: 60 * 60 * 24 * 365, sameSite: "lax", httpOnly: true });
  redirect(target(form, "notice", "scope"));
}
