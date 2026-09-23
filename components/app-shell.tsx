import Link from "next/link";
import type { ReactNode } from "react";
import { signOut } from "@/app/login/actions";
import { NotificationListener } from "@/components/notification-listener";
import type { Profile, UserRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

const svg = { viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": true } as const;

type NavItem = { href: string; label: string; roles: UserRole[]; icon: ReactNode };

const sections: { label: string; items: NavItem[] }[] = [
  { label: "OPERAȚIUNI", items: [
    { href: "/orders", label: "Comenzi online", roles: ["admin", "operator_depozit"], icon: <svg {...svg}><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18M8 14h4"/></svg> },
    { href: "/refill", label: "Refill revânzători", roles: ["admin", "operator_depozit"], icon: <svg {...svg}><path d="M3 7h13v10H3zM16 10h3l2 3v4h-5"/><circle cx="7" cy="18" r="1.6"/><circle cx="18" cy="18" r="1.6"/></svg> },
    { href: "/orders/search", label: "Căutare comenzi", roles: ["admin", "operator_depozit", "operator_facturare"], icon: <svg {...svg}><circle cx="11" cy="11" r="6"/><path d="m20 20-4.2-4.2"/></svg> },
    { href: "/returns", label: "Retururi", roles: ["admin", "operator_depozit", "operator_facturare"], icon: <svg {...svg}><path d="M9 14 4 9l5-5"/><path d="M4 9h11a5 5 0 0 1 0 10h-3"/></svg> },
    { href: "/billing", label: "Facturare refill", roles: ["admin", "operator_facturare"], icon: <svg {...svg}><path d="M6 3h12v18l-3-2-3 2-3-2-3 2z"/><path d="M9 8h6M9 12h6"/></svg> },
  ] },
  { label: "MONITORIZARE", items: [
    { href: "/dashboard", label: "Dashboard", roles: ["admin", "owner"], icon: <svg {...svg}><path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/></svg> },
  ] },
  { label: "ADMINISTRARE", items: [
    { href: "/admin/resellers", label: "Revânzători", roles: ["admin"], icon: <svg {...svg}><path d="M4 20v-8l8-4 8 4v8M4 14h16M9 20v-4h6v4M12 8V4"/></svg> },
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
  const { count: unread } = await supabase.from("notifications").select("id", { count: "exact", head: true })
    .is("read_at", null).or(`recipient_user_id.eq.${profile.id},recipient_role.eq.${profile.role}`);
  return (
    <main className="app-shell">
      <aside className="app-sidebar" aria-label="Navigație principală">
        <div className="brand"><div className="brand-icon">B<span>·</span></div><div><strong>BoldHub</strong><small>ATELIER REBUL</small></div></div>
        <div className="sidebar-workspace"><span className="workspace-avatar">AR</span><span><strong>Atelier Rebul</strong><small>Spațiu de lucru</small></span></div>
        <nav className="sidebar-nav">
          {visible.map((group, index) => <div className="sidebar-group" key={group.label}>
            <p className={index === 0 ? "sidebar-label" : "sidebar-label admin-sidebar-label"}>{group.label}</p>
            {group.items.map(item => item.href === active
              ? <span className="sidebar-link active" aria-current="page" key={item.href} title={item.label}>{item.icon}{item.label}</span>
              : <Link className="sidebar-link" href={item.href} key={item.href} title={item.label}>{item.icon}{item.label}</Link>)}
          </div>)}
        </nav>
        <div className="sidebar-bottom"><span className="sidebar-bottom-icon" aria-hidden="true">i</span><div><strong>{note.title}</strong><p>{note.text}</p></div></div>
      </aside>
      <div className="app-main">
        <header className="topbar">
          <div className="breadcrumb"><span>{section}</span><span aria-hidden="true">/</span><strong>{title}</strong></div>
          <div className="topbar-right">{topbarExtra}
            <Link href="/notifications" className={active === "/notifications" ? "bell-link active" : "bell-link"} aria-label={`Notificări${unread ? `, ${unread} necitite` : ""}`}>{bellIcon}{unread ? <span className="bell-count">{unread > 99 ? "99+" : unread}</span> : null}</Link>
            <NotificationListener role={profile.role} userId={profile.id}/>
            <div className="user-menu"><span className="user-avatar" aria-hidden="true">{profile.full_name?.trim().charAt(0).toUpperCase() || "A"}</span><span className="user-name">{profile.full_name}</span><form action={signOut}><button type="submit" className="text-button">Ieșire</button></form></div></div>
        </header>
        <div className="page-content">{children}</div>
      </div>
    </main>
  );
}
