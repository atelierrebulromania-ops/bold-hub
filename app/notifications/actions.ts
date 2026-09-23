"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Works for staff and resellers alike; the RPC only touches rows addressed to the caller.
export async function markRead(form: FormData) {
  const supabase = await createClient();
  const raw = form.get("id");
  const back = form.get("back") === "/reseller" ? "/reseller" : "/notifications";
  const ids = typeof raw === "string" && uuid.test(raw) ? [raw] : null;
  if (raw !== null && !ids) redirect(back);
  await supabase.rpc("mark_notifications_read", { p_ids: ids });
  revalidatePath("/", "layout");
  redirect(back);
}
