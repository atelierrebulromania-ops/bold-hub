"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth";
import { parseChannel, type Channel } from "@/lib/channels";
import { reserveCartInBocp } from "@/lib/b2b-bocp";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// The warehouse prepares a cart with what it actually put (lines: only the cart items it put less of,
// with the quantity put). Shortfalls
// become backorders; backorders already on the partner's shelf join this delivery.
export async function prepareCart(cartId: string, lines: { itemId: string; quantity: number }[]): Promise<{ ok: boolean; message: string }> {
  if (!uuid.test(cartId) || lines.length > 500 || !lines.every((line) => uuid.test(line.itemId) && Number.isInteger(line.quantity) && line.quantity >= 0)) {
    return { ok: false, message: "Cantitățile nu sunt valide." };
  }
  const { supabase } = await requireRole(["admin", "operator_depozit"]);
  const { data, error } = await supabase.rpc("prepare_partner_cart", {
    p_cart_id: cartId, p_lines: lines.map((line) => ({ item_id: line.itemId, quantity: line.quantity })),
  });
  if (error) return { ok: false, message: "Nu am putut salva. Încearcă din nou." };
  revalidatePath("/partners");
  if (data === "empty") return { ok: true, message: "Nimic de pus acum: toate produsele au trecut la restanțe. Agentul a fost anunțat." };
  if (data !== "prepared") return { ok: false, message: "Coșul s-a schimbat între timp. Reîncarcă pagina." };
  const short = lines.length > 0;
  const bocp = await reserveCartInBocp(supabase, cartId);
  revalidatePath("/billing");
  const shelf = short ? "Produsele sunt pe raft; ce lipsește a trecut la restanțe." : "Produsele sunt pe raft.";
  return bocp.ok ? { ok: true, message: `${shelf} ${bocp.message}` }
    : { ok: true, message: `${shelf} Rezervarea în BOCP nu a reușit: ${bocp.message} Facturarea a fost anunțată.` };
}

export async function shelveBackorder(backorderId: string, quantity: number): Promise<{ ok: boolean; message: string }> {
  if (!uuid.test(backorderId) || !Number.isInteger(quantity) || quantity < 1) return { ok: false, message: "Cantitatea nu este validă." };
  const { supabase } = await requireRole(["admin", "operator_depozit"]);
  const { data } = await supabase.rpc("shelve_backorder", { p_id: backorderId, p_quantity: quantity });
  revalidatePath("/partners");
  return data ? { ok: true, message: "Pus pe raft. Pleacă la următoarea livrare a partenerului." }
    : { ok: false, message: "Restanța s-a schimbat între timp sau cantitatea e mai mare decât restanța." };
}

export async function cancelBackorder(backorderId: string, reason: string): Promise<{ ok: boolean; message: string }> {
  if (!uuid.test(backorderId)) return { ok: false, message: "Restanța nu este validă." };
  if (!reason.trim()) return { ok: false, message: "Scrie motivul anulării." };
  const { supabase } = await requireRole(["admin", "account"]);
  const { data, error } = await supabase.rpc("cancel_backorder", { p_id: backorderId, p_reason: reason });
  if (error) return { ok: false, message: "Doar agentul clientului sau administratorul pot anula restanța." };
  revalidatePath("/partners");
  return data ? { ok: true, message: "Restanța a fost anulată." } : { ok: false, message: "Restanța nu mai este deschisă." };
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
  const { supabase } = await requireRole(["admin", "operator_depozit", "account"]);
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

// A request the client made outside the app (phone, message, visit): the products go into the partner's open cart
// (the partner moves to "Necesită produse") and the stock is reserved.
export async function addPartnerRequest(partnerId: string, items: { productId: string; quantity: number }[], source: string, locationId: string | null = null, channel: Channel = "resale"): Promise<{ ok: boolean; message: string }> {
  if (!uuid.test(partnerId) || (locationId !== null && !uuid.test(locationId)) || !["whatsapp", "telefon"].includes(source) || items.length === 0 || items.length > 100
    || !items.every((item) => uuid.test(item.productId) && Number.isSafeInteger(item.quantity) && item.quantity >= 1 && item.quantity <= 100000)) {
    return { ok: false, message: "Alege partenerul, produsele și cantitățile." };
  }
  const { supabase } = await requireRole(["admin", "operator_depozit", "account"]);
  const { error } = await supabase.rpc("staff_add_refill", {
    p_partner_id: partnerId,
    p_items: items.map((item) => ({ product_id: item.productId, quantity: item.quantity, channel: parseChannel(channel) })),
    p_source: source,
    p_location_id: locationId,
  });
  if (error) return { ok: false, message: "Nu am putut salva cererea. Încearcă din nou." };
  revalidatePath("/partners");
  const units = items.reduce((sum, item) => sum + item.quantity, 0);
  return { ok: true, message: `Cererea a fost adăugată: ${units} buc. în coș, stocul a fost rezervat.` };
}
