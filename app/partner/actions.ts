"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requirePartner } from "@/lib/auth";

const page = "/partner";
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function submitCounts(form: FormData) {
  const { supabase, partner, preview } = await requirePartner();
  const counts: { product_id: string; remaining: string }[] = [];
  for (const [key, value] of form.entries()) {
    if (!key.startsWith("remaining_") || typeof value !== "string" || value.trim() === "") continue;
    const productId = key.slice("remaining_".length);
    if (!uuid.test(productId) || !/^\d{1,6}$/.test(value.trim())) redirect(`${page}?error=invalid`);
    counts.push({ product_id: productId, remaining: value.trim() });
  }
  if (counts.length === 0) redirect(`${page}?error=empty`);
  // In dev mode the admin previews the location: the request is sent on the partner's behalf.
  const { data, error } = preview
    ? await supabase.rpc("submit_refill_counts_for", { p_partner_id: partner.id, p_counts: counts })
    : await supabase.rpc("submit_refill_counts", { p_counts: counts });
  if (error) redirect(`${page}?error=save_failed`);
  const units = Number((data as { units?: number } | null)?.units ?? 0);
  revalidatePath(page);
  redirect(units > 0 ? `${page}?notice=added&units=${units}` : `${page}?notice=nothing`);
}

export async function removeOwnItem(form: FormData) {
  const { supabase } = await requirePartner();
  const itemId = form.get("item_id");
  if (typeof itemId !== "string" || !uuid.test(itemId)) redirect(`${page}?error=invalid`);
  const { data, error } = await supabase.rpc("remove_cart_item", { p_item_id: itemId });
  revalidatePath(page);
  redirect(!error && data === true ? `${page}?notice=removed` : `${page}?error=stale`);
}

export async function markNewsRead() {
  const { supabase, preview } = await requirePartner();
  if (!preview) await supabase.rpc("mark_notifications_read", { p_ids: null });
  revalidatePath(page);
}
