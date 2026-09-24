import { AppShell } from "@/components/app-shell";
import { requireRole } from "@/lib/auth";
import type { Order } from "@/lib/orders";
import { OrderBoard } from "./order-board";

export const dynamic = "force-dynamic";

export default async function OrdersPage() {
  const { supabase, userId, profile } = await requireRole(["admin", "operator_depozit"]);

  const fields = "id,invoice_number,bocp_order_id,source,customer_name,customer_phone,customer_email,shipping_address,status,claimed_by,invoice_pdf_url,created_at,online_order_items(id,scan_code_type,quantity,scanned_quantity,is_gift,ean,products(name,sku,variant_label,ean))" as const;
  const [openResult, staffResult] = await Promise.all([
    supabase.from("online_orders").select(fields)
      .in("status", ["pending", "claimed", "preparing", "ready"])
      .order("created_at", { ascending: false }).limit(500),
    supabase.rpc("staff_names"),
  ]);
  const operatorNames = Object.fromEntries((staffResult.data ?? []).map((user) => [user.id, user.full_name]));
  const error = openResult.error;
  // Reduce each EAN to a yes/no here, so the code itself is never sent to the browser.
  const orders: Order[] = (openResult.data ?? []).map(({ online_order_items, ...order }) => ({
    ...order,
    online_order_items: online_order_items.map(({ ean, products, ...item }) => ({
      ...item,
      no_ean: !ean?.trim() && !products?.ean?.trim(),
      products: products && { name: products.name, sku: products.sku, variant_label: products.variant_label },
    })),
  }));
  return (
    <AppShell profile={profile} active="/orders" section="Depozit" title="Comenzi online"
      note={{ title: "Flux operațional", text: "Comenzile sunt actualizate automat." }}
      topbarExtra={<><div className="live-indicator"><span className="live-dot" /> Actualizare automată</div><span className="topbar-divider" /></>}>
      {error ? <div className="notice error" role="alert">Comenzile nu pot fi încărcate acum. Reîncarcă pagina.</div> : <OrderBoard orders={orders} userId={userId} operatorNames={operatorNames} />}
    </AppShell>
  );
}
