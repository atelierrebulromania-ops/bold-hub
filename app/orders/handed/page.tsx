import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { requireRole } from "@/lib/auth";
import { resolveRange, type RangePreset } from "@/lib/dashboard-range";
import { HandedTable, type HandedOrder } from "./handed-table";

export const dynamic = "force-dynamic";

const pageSize = 50;

const presets: { value: Exclude<RangePreset, "custom">; label: string }[] = [
  { value: "today", label: "Azi" },
  { value: "7d", label: "7 zile" },
  { value: "30d", label: "30 zile" },
  { value: "month", label: "Luna curentă" },
];


export default async function HandedOrdersPage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string; from?: string; to?: string; page?: string }>;
}) {
  const { supabase, profile } = await requireRole(["admin", "operator_depozit"]);
  const params = await searchParams;
  const range = resolveRange({ range: params.range ?? "today", from: params.from, to: params.to });
  const page = Math.max(1, Number.parseInt(params.page ?? "1", 10) || 1);
  const offset = (page - 1) * pageSize;

  const [ordersResult, staffResult] = await Promise.all([
    supabase.from("online_orders")
      .select("id,invoice_number,bocp_order_id,source,customer_name,customer_phone,customer_email,shipping_address,claimed_by,claimed_at,ready_at,completed_at,created_at,invoice_pdf_url,online_order_items(id,quantity,products(name,sku,variant_label))", { count: "exact" })
      .eq("status", "handed_to_courier")
      .gte("completed_at", range.from.toISOString()).lt("completed_at", range.to.toISOString())
      .order("completed_at", { ascending: false })
      .range(offset, offset + pageSize - 1),
    supabase.rpc("staff_names"),
  ]);
  const orders: HandedOrder[] = ordersResult.data ?? [];
  const total = ordersResult.count ?? 0;
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const names = Object.fromEntries((staffResult.data ?? []).map((user) => [user.id, user.full_name]));
  const rangeQuery = range.preset === "custom" ? `range=custom&from=${range.fromDay}&to=${range.toDay}` : `range=${range.preset}`;

  return (
    <AppShell profile={profile} active="/orders/handed" section="Istoric" title="Predate curierului"
      note={{ title: "Doar vizualizare", text: "Comenzile predate nu se mai modifică de aici." }}>
      <div className="dashboard-filters" role="group" aria-label="Interval">
        <div className="dashboard-presets">{presets.map(preset => <Link key={preset.value} href={`/orders/handed?range=${preset.value}`}
          className={range.preset === preset.value ? "preset active" : "preset"} aria-current={range.preset === preset.value ? "true" : undefined}>{preset.label}</Link>)}</div>
        <form action="/orders/handed" method="get" className="dashboard-custom">
          <input type="hidden" name="range" value="custom"/>
          <label>De la <input type="date" name="from" defaultValue={range.fromDay} required/></label>
          <label>Până la <input type="date" name="to" defaultValue={range.toDay} required/></label>
          <button type="submit" className={range.preset === "custom" ? "button button-primary" : "button button-outline"}>Aplică</button>
        </form>
      </div>

      <section className="admin-card">
        <div className="admin-card-heading"><h2>Predate curierului</h2><p>{total} {total === 1 ? "comandă predată" : "comenzi predate"} în intervalul ales.</p></div>
        {ordersResult.error ? <p className="notice error search-notice" role="alert">Comenzile nu pot fi încărcate acum. Reîncarcă pagina.</p>
          : orders.length === 0 ? <p className="admin-empty-note">Nicio comandă predată în acest interval.</p>
          : <HandedTable orders={orders} operatorNames={names} />}
        {pages > 1 && <nav className="pager" aria-label="Pagini">
          {page > 1 ? <Link className="button button-outline" href={`/orders/handed?${rangeQuery}&page=${page - 1}`}>← Înapoi</Link> : <span />}
          <span className="result-count">Pagina {page} din {pages}</span>
          {page < pages ? <Link className="button button-outline" href={`/orders/handed?${rangeQuery}&page=${page + 1}`}>Înainte →</Link> : <span />}
        </nav>}
      </section>
    </AppShell>
  );
}
