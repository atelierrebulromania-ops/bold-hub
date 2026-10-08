import "server-only";
import webpush from "web-push";
import { createAdminClient } from "@/lib/supabase/admin";
import type { UserRole } from "@/lib/auth";

// Where a push opens, by what the notification is about and who receives it.
function linkFor(entity: string | null, role: UserRole | null) {
  if (entity === "partner_cart" || entity === "delivery") return role === "operator_facturare" ? "/billing" : "/partners";
  if (entity === "order_return") return "/returns";
  if (entity === "sales_document") return role === "operator_facturare" ? "/billing" : "/account/offers";
  return "/";
}

export function pushConfigured() {
  return !!(process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY && process.env.VAPID_SUBJECT);
}

// Sends the staff notifications not pushed yet to every device their recipients enabled. Each
// notification is claimed once, so overlapping runs never push it twice. Dead subscriptions are removed.
export async function dispatchPush(limit = 50): Promise<{ notifications: number; sent: number; removed: number }> {
  const supabase = createAdminClient();
  if (!supabase || !pushConfigured()) return { notifications: 0, sent: 0, removed: 0 };
  webpush.setVapidDetails(process.env.VAPID_SUBJECT!, process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY!, process.env.VAPID_PRIVATE_KEY!);

  const { data: claimed } = await supabase.rpc("claim_push_notifications", { p_limit: limit });
  const notifications = claimed ?? [];
  if (!notifications.length) return { notifications: 0, sent: 0, removed: 0 };

  const roles = [...new Set(notifications.flatMap((item) => item.recipient_role ? [item.recipient_role] : []))];
  const userIds = [...new Set(notifications.flatMap((item) => item.recipient_user_id ? [item.recipient_user_id] : []))];
  const { data: users } = await supabase.from("app_users").select("id,role").eq("active", true)
    .or([roles.length ? `role.in.(${roles.join(",")})` : "", userIds.length ? `id.in.(${userIds.join(",")})` : ""].filter(Boolean).join(","));
  const roleOf = new Map((users ?? []).map((user) => [user.id, user.role as UserRole]));
  const { data: subscriptions } = await supabase.from("push_subscriptions").select("id,user_id,endpoint,p256dh,auth")
    .in("user_id", [...roleOf.keys()]);

  let sent = 0;
  const dead: string[] = [];
  const used: string[] = [];
  await Promise.all(notifications.flatMap((item) => {
    const recipients = item.recipient_user_id ? [item.recipient_user_id]
      : (users ?? []).filter((user) => user.role === item.recipient_role).map((user) => user.id);
    return (subscriptions ?? []).filter((subscription) => recipients.includes(subscription.user_id)).map(async (subscription) => {
      const payload = JSON.stringify({ title: "BoldHub", body: item.message, tag: item.id,
        url: linkFor(item.related_entity_type, item.recipient_role ?? roleOf.get(subscription.user_id) ?? null) });
      try {
        await webpush.sendNotification({ endpoint: subscription.endpoint, keys: { p256dh: subscription.p256dh, auth: subscription.auth } }, payload, { TTL: 3600 });
        sent++;
        used.push(subscription.id);
      } catch (error) {
        const status = (error as { statusCode?: number }).statusCode;
        if (status === 404 || status === 410) dead.push(subscription.id);
      }
    });
  }));
  if (dead.length) await supabase.from("push_subscriptions").delete().in("id", dead);
  if (used.length) await supabase.from("push_subscriptions").update({ last_used_at: new Date().toISOString() }).in("id", [...new Set(used)]);
  return { notifications: notifications.length, sent, removed: dead.length };
}
