"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireRole } from "@/lib/auth";
import type { ReturnReason } from "@/lib/orders";

const page = "/returns";
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const reasons: ReturnReason[] = ["neridicat", "refuzat_livrare", "produs_deteriorat", "altul"];

function target(form: FormData, key: "notice" | "error", code: string) {
  const query = form.get("q");
  const params = new URLSearchParams({ [key]: code });
  if (typeof query === "string" && query.trim()) params.set("q", query.trim().slice(0, 120));
  return `${page}?${params}`;
}

function id(form: FormData, key: string) {
  const raw = form.get(key);
  return typeof raw === "string" && uuid.test(raw) ? raw : null;
}

function finish(form: FormData, ok: boolean, success: string, failure: string): never {
  revalidatePath(page);
  redirect(target(form, ok ? "notice" : "error", ok ? success : failure));
}

export async function registerReturn(form: FormData) {
  const { supabase } = await requireRole(["admin", "operator_facturare"]);
  const orderId = id(form, "order_id");
  const reason = form.get("reason");
  if (!orderId || typeof reason !== "string" || !reasons.includes(reason as ReturnReason)) {
    redirect(target(form, "error", "invalid"));
  }
  const { data, error } = await supabase.rpc("register_order_return", {
    p_order_id: orderId,
    p_reason: reason as ReturnReason,
    p_shopify_marked: form.get("shopify_marked") === "on",
  });
  if (error) redirect(target(form, "error", "save_failed"));
  finish(form, data === true, "registered", "not_returnable");
}

export async function confirmRestock(form: FormData) {
  const { supabase } = await requireRole(["admin", "operator_depozit"]);
  const returnId = id(form, "return_id");
  if (!returnId) redirect(target(form, "error", "invalid"));
  const { data, error } = await supabase.rpc("confirm_return_restock", { p_return_id: returnId });
  if (error) redirect(target(form, "error", "save_failed"));
  finish(form, data === true, "restocked", "already_done");
}

export async function markShopify(form: FormData) {
  const { supabase } = await requireRole(["admin", "operator_facturare"]);
  const returnId = id(form, "return_id");
  if (!returnId) redirect(target(form, "error", "invalid"));
  const { data, error } = await supabase.rpc("mark_return_in_shopify", { p_return_id: returnId });
  if (error) redirect(target(form, "error", "save_failed"));
  finish(form, data === true, "shopify_marked", "already_done");
}
