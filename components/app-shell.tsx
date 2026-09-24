import Link from "next/link";
import type { ReactNode } from "react";
import { signOut } from "@/app/login/actions";
import { NavCountsListener } from "@/components/nav-counts-listener";
import { NotificationListener } from "@/components/notification-listener";
import { NotificationRail } from "@/components/notification-rail";
import { NotificationToggle } from "@/components/notification-toggle";
import type { Profile, UserRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

const svg = { viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": true } as const;

type NavItem = { href: string; label: string; roles: UserRole[]; icon: ReactNode; counter?: Counter };
type Counter = "orders" | "partners" | "returns";
const counterTables: Record<Counter, string> = { orders: "online_orders", partners: "partner_carts", returns: "order_returns" };

const sections: { label: string; items: NavItem[] }[] = [
  { label: "OPERAȚIUNI", items: [
    { href: "/orders", label: "Comenzi online", roles: ["admin", "operator_depozit"], counter: "orders", icon: <svg {...svg}><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18M8 14h4"/></svg> },
    { href: "/partners", label: "Comenzi B2B", roles: ["admin", "operator_depozit"], counter: "partners", icon: <svg {...svg}><circle cx="9" cy="8" r="3"/><path d="M3 20a6 6 0 0 1 12 0"/><circle cx="17" cy="9" r="2.4"/><path d="M16 14.2a5 5 0 0 1 5 5.8"/></svg> },
    { href: "/returns", label: "Retururi", roles: ["admin", "operator_depozit", "operator_facturare"], counter: "returns", icon: <svg {...svg}><path d="M9 14 4 9l5-5"/><path d="M4 9h11a5 5 0 0 1 0 10h-3"/></svg> },
    { href: "/billing", label: "Facturare refill", roles: ["admin", "operator_facturare"], icon: <svg {...svg}><path d="M6 3h12v18l-3-2-3 2-3-2-3 2z"/><path d="M9 8h6M9 12h6"/></svg> },
  ] },
  { label: "ISTORIC", items: [
    { href: "/orders/handed", label: "Predate curierului", roles: ["admin", "operator_depozit", "operator_facturare"], icon: <svg {...svg}><path d="M3 7h13v10H3zM16 10h3l2 3v4h-5"/><circle cx="7" cy="18" r="1.6"/><circle cx="18" cy="18" r="1.6"/></svg> },
  ] },
  { label: "MONITORIZARE", items: [
    { href: "/dashboard", label: "Dashboard", roles: ["admin", "owner"], icon: <svg {...svg}><path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/></svg> },
  ] },
  { label: "ADMINISTRARE", items: [
    { href: "/admin/users", label: "Utilizatori", roles: ["admin"], icon: <svg {...svg}><circle cx="12" cy="8" r="3.5"/><path d="M5 20a7 7 0 0 1 14 0"/></svg> },
    { href: "/admin/partners", label: "Revânzători", roles: ["admin"], icon: <svg {...svg}><path d="M4 20v-8l8-4 8 4v8M4 14h16M9 20v-4h6v4M12 8V4"/></svg> },
    { href: "/admin/catalog", label: "Catalog & EAN", roles: ["admin"], icon: <svg {...svg}><path d="M4 6v12M7 6v12M11 6v12M14 6v12M18 6v12M20 6v12"/></svg> },
    { href: "/admin/integrations", label: "Integrări", roles: ["admin"], icon: <svg {...svg}><path d="M4 7h8M4 17h8M16 4v6M16 14v6"/><circle cx="16" cy="12" r="2"/><circle cx="8" cy="12" r="2"/></svg> },
  ] },
];

const bellIcon = <svg {...svg}><path d="M6 16V11a6 6 0 0 1 12 0v5l2 2H4z"/><path d="M10 20a2 2 0 0 0 4 0"/></svg>;

export async function AppShell({ profile, active, section, title, note, topbarExtra, children }: {
  profile: Profile;
  active: string;
  section: string;
  title: string;
  note: { title: string; text: string };
  topbarExtra?: ReactNode;
  children: ReactNode;
}) {
  const visible = sections
    .map(group => ({ ...group, items: group.items.filter(item => item.roles.includes(profile.role)) }))
    .filter(group => group.items.length > 0);
  // Admin can read every row, so count only what is addressed to this user or role.
  const supabase = await createClient();
  const addressed = `recipient_user_id.eq.${profile.id},recipient_role.eq.${profile.role}`;
  const shown = new Set(visible.flatMap(group => group.items.flatMap(item => item.counter ? [item.counter] : [])));
  const countOf = (enabled: boolean, query: () => PromiseLike<{ count: number | null }>) =>
    enabled ? Promise.resolve(query()).then(result => result.count ?? 0) : Promise.resolve(0);
  const [{ count: unread }, { data: recent }, orders, partners, returns] = await Promise.all([
    supabase.from("notifications").select("id", { count: "exact", head: true }).is("read_at", null).or(addressed),
    supabase.from("notifications").select("id,message,related_entity_type,read_at,created_at")
      .or(addressed).order("created_at", { ascending: false }).limit(30),
    countOf(shown.has("orders"), () => supabase.from("online_orders").select("id", { count: "exact", head: true })
      .eq("status", "pending")),
    countOf(shown.has("partners"), () => supabase.from("partner_carts").select("id", { count: "exact", head: true })
      .eq("status", "open")),
    countOf(shown.has("returns"), () => supabase.from("order_returns").select("id", { count: "exact", head: true })
      .eq("status", "pending_restock")),
  ]);
  const counts: Record<Counter, number> = { orders, partners, returns };
  const badge = (item: NavItem) => item.counter && counts[item.counter] > 0
    ? <span className="nav-count" aria-label={`${counts[item.counter]} de procesat`}>{counts[item.counter]}</span> : null;
  return (
    <main className="app-shell" data-rail="open">
      <aside className="app-sidebar" aria-label="Navigație principală">
        <div className="brand"><div className="brand-icon">B<span>·</span></div><div><strong>BoldHub</strong><small>ATELIER REBUL</small></div></div>
        <nav className="sidebar-nav">
          {visible.map((group, index) => <div className="sidebar-group" key={group.label}>
            <p className={index === 0 ? "sidebar-label" : "sidebar-label admin-sidebar-label"}>{group.label}</p>
            {group.items.map(item => item.href === active
              ? <span className="sidebar-link active" aria-current="page" key={item.href} title={item.label}>{item.icon}{item.label}{badge(item)}</span>
              : <Link className="sidebar-link" href={item.href} key={item.href} title={item.label}>{item.icon}{item.label}{badge(item)}</Link>)}
          </div>)}
        </nav>
        <div className="user-menu sidebar-user"><span className="user-avatar" aria-hidden="true">{profile.full_name?.trim().charAt(0).toUpperCase() || "A"}</span><span className="user-name">{profile.full_name}</span><form action={signOut}><button type="submit" className="logout-button" aria-label="Ieșire din cont" title="Ieșire din cont"><svg {...svg}><path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3"/><path d="M10 17l-5-5 5-5M5 12h11"/></svg></button></form></div>
        <div className="sidebar-bottom"><span className="sidebar-bottom-icon" aria-hidden="true">i</span><div><strong>{note.title}</strong><p>{note.text}</p></div></div>
      </aside>
      <div className="app-main">
        <header className="topbar">
          <div className="breadcrumb"><span>{section}</span><span aria-hidden="true">/</span><strong>{title}</strong></div>
          <div className="topbar-right">{topbarExtra}
            <NotificationToggle unread={unread ?? 0} icon={bellIcon} />
            <NotificationListener role={profile.role} userId={profile.id}/>
            {shown.size > 0 && <NavCountsListener tables={[...shown].map(counter => counterTables[counter])} />}</div>
        </header>
        <div className="page-content">{children}</div>
      </div>
      <NotificationRail notifications={recent ?? []} role={profile.role} />
    </main>
  );
}
