import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { EnableBrowserNotifications } from "@/components/notification-listener";
import { requireRole } from "@/lib/auth";
import { formatDateTime } from "@/lib/orders";
import { markRead } from "./actions";

export const dynamic = "force-dynamic";

const entityLinks: Record<string, string> = {
  delivery: "/partners",
  partner_cart: "/partners",
  order_return: "/returns",
};

export default async function NotificationsPage() {
  const { supabase, profile } = await requireRole(["admin", "owner", "operator_depozit", "operator_facturare"]);
  const { data, error } = await supabase.from("notifications")
    .select("id,type,message,related_entity_type,read_at,created_at,recipient_role")
    .or(`recipient_user_id.eq.${profile.id},recipient_role.eq.${profile.role}`)
    .order("created_at", { ascending: false }).limit(100);
  const notifications = data ?? [];
  const unread = notifications.filter(item => !item.read_at).length;
  // Billing reaches deliveries through its own screen.
  const linkFor = (type: string | null) => (type === "delivery" || type === "partner_cart") && profile.role === "operator_facturare"
    ? "/billing" : type ? entityLinks[type] : undefined;

  return (
    <AppShell profile={profile} active="/notifications" section="Cont" title="Notificări"
      note={{ title: "Notificări pe rol", text: "Un mesaj marcat ca citit dispare pentru toată echipa rolului." }}>
      <div className="page-heading"><div><h1>Notificări</h1><p className="muted">Evenimentele care cer atenția ta. Cele trimise rolului tău sunt comune pentru toată echipa.</p></div>
        <div className="heading-actions"><EnableBrowserNotifications/>{unread > 0 && <form action={markRead}><button className="button button-primary" type="submit">Marchează toate ca citite</button></form>}</div>
      </div>
      <section className="admin-card">
        {error ? <p className="notice error search-notice" role="alert">Notificările nu pot fi încărcate acum.</p>
          : notifications.length === 0 ? <p className="admin-empty-note">Nu ai notificări.</p>
          : <ul className="notification-list">{notifications.map(item => {
            const href = linkFor(item.related_entity_type);
            return <li key={item.id} className={item.read_at ? "notification read" : "notification"}>
              <span className="notification-dot" aria-hidden="true"/>
              <div><p>{item.message}</p><small>{formatDateTime(item.created_at)}{item.read_at ? " · citită" : ""}</small></div>
              <div className="notification-actions">
                {href && <Link className="text-button" href={href}>Deschide</Link>}
                {!item.read_at && <form action={markRead}><input type="hidden" name="id" value={item.id}/><button className="text-button" type="submit">Marchează citită</button></form>}
              </div>
            </li>;
          })}</ul>}
      </section>
    </AppShell>
  );
}
