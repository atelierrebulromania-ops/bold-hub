import { AppShell } from "@/components/app-shell";
import { requireRole } from "@/lib/auth";
import type { Order } from "@/lib/orders";
import { OrderBoard } from "./order-board";

export const dynamic = "force-dynamic";

export default async function OrdersPage() {
  const { supabase, userId, profile } = await requireRole(["admin", "operator_depozit"]);

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
    <AppShell profile={profile} active="/orders" section="Depozit" title="Comenzi online"
      note={{ title: "Flux operațional", text: "Comenzile sunt actualizate automat." }}
      topbarExtra={<><div className="live-indicator"><span className="live-dot" /> Actualizare automată</div><span className="topbar-divider" /></>}>
      <div className="page-heading"><div><p className="eyebrow">OPERAȚIUNI DEPOZIT</p><h1>Comenzi online</h1><p className="muted">Preia, pregătește și predă comenzile dintr-un singur loc.</p></div><span className="page-heading-chip"><span className="live-dot" /> În timp real</span></div>
      {error ? <div className="notice error" role="alert">Comenzile nu pot fi încărcate acum. Reîncarcă pagina.</div> : <OrderBoard orders={orders} userId={userId} />}
    </AppShell>
  );
}
