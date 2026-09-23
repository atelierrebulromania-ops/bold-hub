"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireRole } from "@/lib/auth";

const page = "/refill";
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const sources = ["whatsapp", "telefon", "app"];

function id(form: FormData, key: string) {
  const raw = form.get(key);
  return typeof raw === "string" && uuid.test(raw) ? raw : null;
}

function back(ok: boolean, notice: string, error: string): never {
  revalidatePath(page);
  redirect(ok ? `${page}?notice=${notice}` : `${page}?error=${error}`);
}

async function warehouse() {
  return (await requireRole(["admin", "operator_depozit"])).supabase;
}

export async function addRefill(form: FormData) {
  const supabase = await warehouse();
  const resellerId = id(form, "reseller_id");
  const rawSku = form.get("sku");
  const sku = typeof rawSku === "string" ? rawSku.trim() : "";
  const quantity = Number(form.get("quantity"));
  const source = String(form.get("source") ?? "");
  if (!resellerId || !sku || sku.length > 100 || !Number.isSafeInteger(quantity) || quantity < 1 || quantity > 100000
    || !sources.includes(source)) back(false, "", "invalid");
  const { data: product } = await supabase.from("products").select("id").eq("sku", sku).eq("active", true).maybeSingle();
  if (!product) back(false, "", "product_missing");
  const { error } = await supabase.rpc("staff_add_refill", {
    p_reseller_id: resellerId, p_items: [{ product_id: product.id, quantity }], p_source: source,
  });
  back(!error, "added", "save_failed");
}

export async function removeItem(form: FormData) {
  const supabase = await warehouse();
  const itemId = id(form, "item_id");
  if (!itemId) back(false, "", "invalid");
  const { data, error } = await supabase.rpc("remove_cart_item", { p_item_id: itemId });
  back(!error && data === true, "removed", "stale");
}

export async function createDelivery(form: FormData) {
  const supabase = await warehouse();
  const cartIds = form.getAll("cart_id").filter((value): value is string => typeof value === "string" && uuid.test(value));
  const rawGroup = form.get("group_id");
  const groupId = typeof rawGroup === "string" && uuid.test(rawGroup) ? rawGroup : null;
  if (cartIds.length === 0) back(false, "", "no_carts");
  const { data, error } = await supabase.rpc("create_manual_delivery", { p_cart_ids: cartIds, p_group: groupId });
  back(!error && !!data, "delivery_created", "stale");
}

async function deliveryAction(form: FormData, rpc: "cancel_delivery" | "confirm_delivery_ready" | "hand_delivery_to_driver", notice: string) {
  const supabase = await warehouse();
  const deliveryId = id(form, "delivery_id");
  if (!deliveryId) back(false, "", "invalid");
  const { data, error } = await supabase.rpc(rpc, { p_delivery_id: deliveryId });
  back(!error && data === true, notice, "stale");
}

export async function cancelDelivery(form: FormData) {
  return deliveryAction(form, "cancel_delivery", "delivery_cancelled");
}

export async function confirmReady(form: FormData) {
  return deliveryAction(form, "confirm_delivery_ready", "ready");
}

export async function handToDriver(form: FormData) {
  return deliveryAction(form, "hand_delivery_to_driver", "handed");
}

export async function releaseCart(form: FormData) {
  const supabase = await warehouse();
  const deliveryId = id(form, "delivery_id");
  const cartId = id(form, "cart_id");
  if (!deliveryId || !cartId) back(false, "", "invalid");
  const { data, error } = await supabase.rpc("release_cart_from_delivery", { p_delivery_id: deliveryId, p_cart_id: cartId });
  back(!error && data === true, "cart_released", "stale");
}
