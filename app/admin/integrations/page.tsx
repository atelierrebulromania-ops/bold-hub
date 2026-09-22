import Link from "next/link";
import { redirect } from "next/navigation";
import { signOut } from "@/app/login/actions";
import { createClient } from "@/lib/supabase/server";
import { PreviewPanel } from "./preview-panel";

export const dynamic = "force-dynamic";

export default async function IntegrationsPage() {
  const supabase = await createClient();
  const { data: authData } = await supabase.auth.getClaims();
  if (!authData?.claims?.sub) redirect("/login");

  const { data: profile } = await supabase.from("app_users")
    .select("full_name,role,active").eq("id", authData.claims.sub).maybeSingle();
  if (!profile?.active || profile.role !== "admin") redirect("/access");

  return (
    <main className="app-shell">
      <aside className="app-sidebar" aria-label="Navigație principală">
        <div className="brand"><div className="brand-icon">B<span>·</span></div><div><strong>BoldHub</strong><small>ATELIER REBUL</small></div></div>
        <div className="sidebar-workspace"><span className="workspace-avatar">AR</span><span><strong>Atelier Rebul</strong><small>Spațiu de lucru</small></span></div>
        <nav className="sidebar-nav">
          <p className="sidebar-label">DEPOZIT</p>
          <Link className="sidebar-link" href="/orders"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18M8 14h4"/></svg>Comenzi online</Link>
          <p className="sidebar-label admin-sidebar-label">ADMINISTRARE</p>
          <Link className="sidebar-link" href="/admin/resellers"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 20v-8l8-4 8 4v8M4 14h16M9 20v-4h6v4M12 8V4"/></svg>Revânzători</Link>
          <span className="sidebar-link active" aria-current="page"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 7h8M4 17h8M16 4v6M16 14v6"/><circle cx="16" cy="12" r="2"/><circle cx="8" cy="12" r="2"/></svg>Integrări</span>
        </nav>
        <div className="sidebar-bottom"><span className="sidebar-bottom-icon" aria-hidden="true">i</span><div><strong>Mod de test</strong><p>Previzualizarea nu importă date.</p></div></div>
      </aside>
      <div className="app-main">
        <header className="topbar">
          <div className="breadcrumb"><span>Administrare</span><span aria-hidden="true">/</span><strong>Integrări</strong></div>
          <div className="topbar-right"><div className="user-menu"><span className="user-avatar" aria-hidden="true">{profile.full_name?.trim().charAt(0).toUpperCase() || "A"}</span><span className="user-name">{profile.full_name}</span><form action={signOut}><button type="submit" className="text-button">Ieșire</button></form></div></div>
        </header>
        <div className="page-content">
          <div className="page-heading"><div><p className="eyebrow">ADMINISTRARE</p><h1>Integrări</h1><p className="muted">Verifică datele BOCP înainte de activarea fluxului operațional.</p></div><span className="page-heading-chip preview-chip">Doar citire</span></div>
          <PreviewPanel importEnabled={new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Bucharest" }) >= "2026-10-01"} />
        </div>
      </div>
    </main>
  );
}
