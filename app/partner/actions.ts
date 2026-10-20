"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requirePartner } from "@/lib/auth";

const page = "/partner";
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function submitCounts(form: FormData) {
  const { supabase, partner, preview } = await requirePartner();
  const channel = form.get("channel") === "consumption" ? "consumption" : form.get("channel") === "resale" ? "resale" : null;
  const counts: { product_id: string; remaining: string; channel: string }[] = [];
  for (const [key, value] of form.entries()) {
    if (!key.startsWith("remaining_") || typeof value !== "string" || value.trim() === "") continue;
    const productId = key.slice("remaining_".length);
    if (!uuid.test(productId) || !/^\d{1,6}$/.test(value.trim())) redirect(`${page}?error=invalid`);
    counts.push({ product_id: productId, remaining: value.trim(), channel: channel ?? "resale" });
  }
  // Per point of work: the counts are for the point picked at the top of the page.
  const point = form.get("point");
  const locationId = typeof point === "string" && uuid.test(point) ? point : null;
  // Back to the same point and channel tab.
  const query = new URLSearchParams();
  if (locationId) query.set("point", locationId);
  if (channel) query.set("channel", channel);
  const back = query.size ? `${page}?${query}&` : `${page}?`;
  if (counts.length === 0) redirect(`${back}error=empty`);
  // In dev mode the admin previews the location: the request is sent on the partner's behalf.
  const { data, error } = preview
    ? await supabase.rpc("submit_refill_counts_for", { p_partner_id: partner.id, p_counts: counts, p_location_id: locationId })
    : await supabase.rpc("submit_refill_counts", { p_counts: counts, p_location_id: locationId });
  if (error) redirect(`${back}error=save_failed`);
  const units = Number((data as { units?: number } | null)?.units ?? 0);
  revalidatePath(page);
  redirect(units > 0 ? `${back}notice=added&units=${units}` : `${back}notice=nothing`);
}

// A line can hold several requests for the same product: all of them are removed.
export async function removeOwnItem(form: FormData) {
  const { supabase } = await requirePartner();
  const itemIds = form.getAll("item_id");
  if (!itemIds.length || itemIds.length > 50 || !itemIds.every((id) => typeof id === "string" && uuid.test(id))) redirect(`${page}?error=invalid`);
  let removed = 0;
  for (const itemId of itemIds as string[]) {
    const { data, error } = await supabase.rpc("remove_cart_item", { p_item_id: itemId });
    if (!error && data === true) removed += 1;
  }
  revalidatePath(page);
  redirect(removed > 0 ? `${page}?notice=removed` : `${page}?error=stale`);
}

export async function markNewsRead() {
  const { supabase, preview } = await requirePartner();
  if (!preview) await supabase.rpc("mark_notifications_read", { p_ids: null });
  revalidatePath(page);
}
