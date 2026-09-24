"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// The missing products are on the reserved shelf: the cart is ready to deliver (billing comes later).
export async function markCartPrepared(cartId: string): Promise<{ ok: boolean; message: string }> {
  if (!uuid.test(cartId)) return { ok: false, message: "Coșul nu este valid." };
  const { supabase } = await requireRole(["admin", "operator_depozit"]);
  const { data, error } = await supabase.rpc("mark_partner_cart_prepared", { p_cart_id: cartId });
  if (error) return { ok: false, message: "Nu am putut salva. Încearcă din nou." };
  revalidatePath("/partners");
  return data === true
    ? { ok: true, message: "Produsele sunt rezervate pe raft. Facturarea a fost anunțată." }
    : { ok: false, message: "Coșul s-a schimbat între timp. Reîncarcă pagina." };
}

// Hand-off to billing: billing is notified and invoices the prepared products.
export async function handCartsToBilling(cartIds: string[]): Promise<{ ok: boolean; message: string }> {
  if (cartIds.length === 0 || cartIds.length > 20 || !cartIds.every((id) => uuid.test(id))) return { ok: false, message: "Coșul nu este valid." };
  const { supabase } = await requireRole(["admin", "operator_depozit"]);
  let handed = 0;
  for (const cartId of cartIds) {
    const { data, error } = await supabase.rpc("hand_partner_cart_to_billing", { p_cart_id: cartId });
    if (error) return { ok: false, message: "Nu am putut salva. Încearcă din nou." };
    if (data === true) handed += 1;
  }
  revalidatePath("/partners");
  return handed > 0
    ? { ok: true, message: "Predat la facturare. Operatorul de facturare a fost notificat." }
    : { ok: false, message: "Coșul s-a schimbat între timp. Reîncarcă pagina." };
}

// Creates (no groupId) or edits a delivery group; the members become exactly partnerIds.
export async function saveDeliveryGroup(groupId: string | null, name: string, partnerIds: string[]): Promise<{ ok: boolean; message: string }> {
  const cleanName = name.trim().replace(/\s+/g, " ");
  if (!cleanName || cleanName.length > 80) return { ok: false, message: "Numele grupului trebuie să aibă între 1 și 80 de caractere." };
  if ((groupId !== null && !uuid.test(groupId)) || partnerIds.length > 500 || !partnerIds.every((id) => uuid.test(id))) {
    return { ok: false, message: "Datele grupului nu sunt valide." };
  }
  const { supabase } = await requireRole(["admin", "operator_depozit"]);
  const { data, error } = await supabase.rpc("save_delivery_group", { p_group_id: groupId, p_name: cleanName, p_partner_ids: partnerIds });
  if (error) return { ok: false, message: "Nu am putut salva. Încearcă din nou." };
  revalidatePath("/partners");
  return data ? { ok: true, message: groupId ? "Grupul a fost actualizat." : "Grupul a fost creat." }
    : { ok: false, message: "Există deja un grup cu acest nume." };
}

export async function deleteDeliveryGroup(groupId: string): Promise<{ ok: boolean; message: string }> {
  if (!uuid.test(groupId)) return { ok: false, message: "Grupul nu este valid." };
  const { supabase } = await requireRole(["admin", "operator_depozit"]);
  const { data, error } = await supabase.rpc("delete_delivery_group", { p_group_id: groupId });
  if (error) return { ok: false, message: "Nu am putut șterge. Încearcă din nou." };
  revalidatePath("/partners");
  return data === true ? { ok: true, message: "Grupul a fost șters." } : { ok: false, message: "Grupul nu mai există." };
}

// A request received by WhatsApp or phone: the products go into the partner's open cart
// (the partner moves to "Necesită produse") and the stock is reserved.
export async function addPartnerRequest(partnerId: string, items: { productId: string; quantity: number }[], source: string): Promise<{ ok: boolean; message: string }> {
  if (!uuid.test(partnerId) || !["whatsapp", "telefon"].includes(source) || items.length === 0 || items.length > 100
    || !items.every((item) => uuid.test(item.productId) && Number.isSafeInteger(item.quantity) && item.quantity >= 1 && item.quantity <= 100000)) {
    return { ok: false, message: "Alege partenerul, produsele și cantitățile." };
  }
  const { supabase } = await requireRole(["admin", "operator_depozit"]);
  const { error } = await supabase.rpc("staff_add_refill", {
    p_partner_id: partnerId,
    p_items: items.map((item) => ({ product_id: item.productId, quantity: item.quantity })),
    p_source: source,
  });
  if (error) return { ok: false, message: "Nu am putut salva cererea. Încearcă din nou." };
  revalidatePath("/partners");
  const units = items.reduce((sum, item) => sum + item.quantity, 0);
  return { ok: true, message: `Cererea a fost adăugată: ${units} buc. în coș, stocul a fost rezervat.` };
}
