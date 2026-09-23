"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireReseller } from "@/lib/auth";

const page = "/reseller";
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function submitCounts(form: FormData) {
  const { supabase } = await requireReseller();
  const counts: { product_id: string; remaining: string }[] = [];
  for (const [key, value] of form.entries()) {
    if (!key.startsWith("remaining_") || typeof value !== "string" || value.trim() === "") continue;
    const productId = key.slice("remaining_".length);
    if (!uuid.test(productId) || !/^\d{1,6}$/.test(value.trim())) redirect(`${page}?error=invalid`);
    counts.push({ product_id: productId, remaining: value.trim() });
  }
  if (counts.length === 0) redirect(`${page}?error=empty`);
  const { data, error } = await supabase.rpc("submit_refill_counts", { p_counts: counts });
  if (error) redirect(`${page}?error=save_failed`);
  const units = Number((data as { units?: number } | null)?.units ?? 0);
  revalidatePath(page);
  redirect(units > 0 ? `${page}?notice=added&units=${units}` : `${page}?notice=nothing`);
}

export async function removeOwnItem(form: FormData) {
  const { supabase } = await requireReseller();
  const itemId = form.get("item_id");
  if (typeof itemId !== "string" || !uuid.test(itemId)) redirect(`${page}?error=invalid`);
  const { data, error } = await supabase.rpc("remove_cart_item", { p_item_id: itemId });
  revalidatePath(page);
  redirect(!error && data === true ? `${page}?notice=removed` : `${page}?error=stale`);
}
