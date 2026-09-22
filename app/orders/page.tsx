import { redirect } from "next/navigation";
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

  const fields = "id,invoice_number,bocp_order_id,source,customer_name,customer_phone,customer_email,shipping_address,status,claimed_by,invoice_pdf_url,created_at,online_order_items(id,ean,quantity,scanned_quantity,products(name,sku,variant_label))" as const;
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
      <header className="topbar">
        <div className="brand"><div className="brand-icon">B<span>·</span></div><div><strong>BoldHub</strong><small>ATELIER REBUL</small></div></div>
        <nav className="topnav" aria-label="Navigație principală"><span className="nav-active">Comenzi online</span></nav>
        <div className="user-menu"><span>{profile.full_name}</span><form action={signOut}><button type="submit" className="text-button">Ieșire</button></form></div>
      </header>
      <div className="page-content">
        <div className="page-heading"><div><p className="eyebrow">Depozit / operațiuni zilnice</p><h1>Comenzi online</h1><p className="muted">De la factură la predarea către curier, totul într-un singur flux.</p></div><div className="live-indicator"><span className="live-dot" /> Board actualizat automat</div></div>
        {error ? <div className="notice error" role="alert">Comenzile nu pot fi încărcate acum. Reîncarcă pagina.</div> : <OrderBoard orders={orders} userId={claims.sub} />}
      </div>
    </main>
  );
}
