"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireRole } from "@/lib/auth";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function setCrmAccess(form: FormData) {
  const { supabase } = await requireRole(["admin"]);
  const userId = String(form.get("user_id") ?? "");
  if (uuid.test(userId)) await supabase.rpc("set_crm_access", { p_user_id: userId, p_on: form.get("on") === "true" });
  revalidatePath("/", "layout");
  redirect("/admin/settings");
}

// A new key stops the old links from working (Make/Zapier/MailerLite must get the new ones).
export async function rotateLeadsKey() {
  const { supabase } = await requireRole(["admin"]);
  await supabase.rpc("rotate_leads_webhook_key");
  revalidatePath("/admin/settings");
  redirect("/admin/settings?notice=rotated");
}

// Hours before a waiting lead raises an alert; 0 turns that alert off.
export async function setLeadAlertHours(form: FormData) {
  const { supabase } = await requireRole(["admin"]);
  const unclaimed = Number(form.get("unclaimed"));
  const uncontacted = Number(form.get("uncontacted"));
  const valid = (hours: number) => Number.isInteger(hours) && hours >= 0 && hours <= 168;
  if (valid(unclaimed) && valid(uncontacted)) await supabase.rpc("set_lead_alert_hours", { p_unclaimed: unclaimed, p_uncontacted: uncontacted });
  revalidatePath("/admin/settings");
  redirect("/admin/settings?notice=alerts");
}

export async function setLeadOfferDays(form: FormData) {
  const { supabase } = await requireRole(["admin"]);
  const days = Number(form.get("days"));
  if (Number.isInteger(days) && days >= 1 && days <= 60) await supabase.rpc("set_lead_offer_days", { p_days: days });
  revalidatePath("/admin/settings");
  redirect("/admin/settings?notice=days");
}
