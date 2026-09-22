import { redirect } from "next/navigation";
import Link from "next/link";
import { signOut } from "@/app/login/actions";
import { createClient } from "@/lib/supabase/server";
import type { Order } from "@/lib/orders";
import { OrderBoard } from "./order-board";

export const dynamic = "force-dynamic";

export default async function OrdersPage() {
  const supabase = await createClient();
  const { data: authData } = await supabase.auth.getClaims();
  const claims = authData?.claims;
  if (!claims?.sub) redirect("/login");

  const { data: profile } = await supabase.from("app_users")
    .select("full_name,role,active").eq("id", claims.sub).maybeSingle();
  if (!profile?.active || !["admin", "operator_depozit"].includes(profile.role)) redirect("/access");

  const fields = "id,invoice_number,bocp_order_id,source,customer_name,customer_phone,customer_email,shipping_address,status,claimed_by,invoice_pdf_url,created_at,online_order_items(id,ean,scan_code,scan_code_type,quantity,scanned_quantity,products(name,sku,variant_label))" as const;
  const recentHandoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const [openResult, handedResult] = await Promise.all([
    supabase.from("online_orders").select(fields)
      .in("status", ["pending", "claimed", "preparing", "ready"])
      .order("created_at", { ascending: false }).limit(500),
    supabase.from("online_orders").select(fields)
      .eq("status", "handed_to_courier").gte("completed_at", recentHandoff)
      .order("completed_at", { ascending: false }).limit(100),
  ]);
  const error = openResult.error ?? handedResult.error;
  const orders: Order[] = [...(openResult.data ?? []), ...(handedResult.data ?? [])];
  return (
    <main className="app-shell">
      <aside className="app-sidebar" aria-label="Navigație principală">
        <div className="brand"><div className="brand-icon">B<span>·</span></div><div><strong>BoldHub</strong><small>ATELIER REBUL</small></div></div>
        <div className="sidebar-workspace"><span className="workspace-avatar">AR</span><span><strong>Atelier Rebul</strong><small>Spațiu de lucru</small></span></div>
        <nav className="sidebar-nav">
          <p className="sidebar-label">DEPOZIT</p>
          <span className="sidebar-link active" aria-current="page"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18M8 14h4"/></svg>Comenzi online</span>
          {profile.role === "admin" && <><p className="sidebar-label admin-sidebar-label">ADMINISTRARE</p><Link className="sidebar-link" href="/admin/resellers"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 20v-8l8-4 8 4v8M4 14h16M9 20v-4h6v4M12 8V4"/></svg>Revânzători</Link><Link className="sidebar-link" href="/admin/integrations"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 7h8M4 17h8M16 4v6M16 14v6"/><circle cx="16" cy="12" r="2"/><circle cx="8" cy="12" r="2"/></svg>Integrări</Link></>}
        </nav>
        <div className="sidebar-bottom"><span className="sidebar-bottom-icon" aria-hidden="true">i</span><div><strong>Flux operațional</strong><p>Comenzile sunt actualizate automat.</p></div></div>
      </aside>
      <div className="app-main">
        <header className="topbar">
          <div className="breadcrumb"><span>Depozit</span><span aria-hidden="true">/</span><strong>Comenzi online</strong></div>
          <div className="topbar-right"><div className="live-indicator"><span className="live-dot" /> Actualizare automată</div><span className="topbar-divider" /><div className="user-menu"><span className="user-avatar" aria-hidden="true">{profile.full_name?.trim().charAt(0).toUpperCase() || "A"}</span><span className="user-name">{profile.full_name}</span><form action={signOut}><button type="submit" className="text-button">Ieșire</button></form></div></div>
        </header>
        <div className="page-content">
          <div className="page-heading"><div><p className="eyebrow">OPERAȚIUNI DEPOZIT</p><h1>Comenzi online</h1><p className="muted">Preia, pregătește și predă comenzile dintr-un singur loc.</p></div><span className="page-heading-chip"><span className="live-dot" /> În timp real</span></div>
          {error ? <div className="notice error" role="alert">Comenzile nu pot fi încărcate acum. Reîncarcă pagina.</div> : <OrderBoard orders={orders} userId={claims.sub} />}
        </div>
      </div>
    </main>
  );
}
