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

type Result = { ok: boolean; message: string };

export async function confirmReturn(returnId: string, note: string | null, withRemarks: boolean): Promise<Result> {
  if (!uuid.test(returnId)) return { ok: false, message: "Returul nu este valid." };
  const text = note?.trim() || null;
  if (text && text.length > 1000) return { ok: false, message: "Nota poate avea cel mult 1000 de caractere." };
  if (withRemarks && !text) return { ok: false, message: "Scrie mai întâi o notă." };
  const { supabase } = await requireRole(["admin", "operator_depozit"]);
  const { data, error } = await supabase.rpc("confirm_return_restock", { p_return_id: returnId, p_with_remarks: withRemarks, ...(text ? { p_note: text } : {}) });
  if (error) return { ok: false, message: "Nu am putut salva. Încearcă din nou." };
  revalidatePath(page);
  return data === true
    ? { ok: true, message: withRemarks ? "Returul a fost procesat cu mențiuni. Facturarea a fost anunțată." : "Returul a fost procesat." }
    : { ok: false, message: "Returul a fost deja procesat. Reîncarcă pagina." };
}

export async function markReturnInShopify(returnId: string): Promise<Result> {
  if (!uuid.test(returnId)) return { ok: false, message: "Returul nu este valid." };
  const { supabase } = await requireRole(["admin"]);
  const { data, error } = await supabase.rpc("mark_return_in_shopify", { p_return_id: returnId });
  if (error) return { ok: false, message: "Nu am putut salva. Încearcă din nou." };
  revalidatePath(page);
  return data === true
    ? { ok: true, message: "Returul a fost marcat ca actualizat în Shopify." }
    : { ok: false, message: "Operațiunea a fost deja făcută." };
}
