"use server";

import { requireRole } from "@/lib/auth";

const staff = ["admin", "owner", "operator_depozit", "operator_facturare", "account"] as const;

type Subscription = { endpoint: string; keys: { p256dh: string; auth: string } };

export async function savePushSubscription(subscription: Subscription, userAgent: string): Promise<boolean> {
  const { supabase } = await requireRole(staff);
  if (typeof subscription?.endpoint !== "string" || !subscription.endpoint.startsWith("https://")) return false;
  const { data } = await supabase.rpc("save_push_subscription", {
    p_endpoint: subscription.endpoint, p_p256dh: subscription.keys?.p256dh ?? "", p_auth: subscription.keys?.auth ?? "", p_user_agent: userAgent.slice(0, 400),
  });
  return data === true;
}

export async function deletePushSubscription(endpoint: string): Promise<boolean> {
  const { supabase } = await requireRole(staff);
  const { data } = await supabase.rpc("delete_push_subscription", { p_endpoint: endpoint });
  return data === true;
}
