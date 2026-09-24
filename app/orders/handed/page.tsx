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
  searchParams: Promise<{ range?: string; from?: string; to?: string; page?: string; q?: string }>;
}) {
  const { supabase, profile } = await requireRole(["admin", "operator_depozit", "operator_facturare"]);
  const params = await searchParams;
  const range = resolveRange({ range: params.range ?? "today", from: params.from, to: params.to });
  const page = Math.max(1, Number.parseInt(params.page ?? "1", 10) || 1);
  const offset = (page - 1) * pageSize;

  const query = (params.q ?? "").trim().slice(0, 120);
  const searching = query.length >= 3;
  const fields = "id,status,invoice_number,bocp_order_id,source,customer_name,customer_phone,customer_email,shipping_address,claimed_by,claimed_at,ready_at,completed_at,created_at,invoice_pdf_url,online_order_items(id,quantity,products(name,sku,variant_label))";

  // A search looks across every handed order (returned ones too), regardless of the chosen interval.
  const searchResult = searching ? await supabase.rpc("search_online_orders", { p_query: query }) : null;
  const matchIds = ((searchResult?.data ?? []) as { id: string }[]).map((order) => order.id);
  const [ordersResult, staffResult] = await Promise.all([
    searching
      ? supabase.from("online_orders").select(fields, { count: "exact" })
        .in("id", matchIds.length ? matchIds : ["00000000-0000-0000-0000-000000000000"])
        .in("status", ["handed_to_courier", "returned"])
        .order("completed_at", { ascending: false })
      : supabase.from("online_orders").select(fields, { count: "exact" })
        .eq("status", "handed_to_courier")
        .gte("completed_at", range.from.toISOString()).lt("completed_at", range.to.toISOString())
        .order("completed_at", { ascending: false })
        .range(offset, offset + pageSize - 1),
    supabase.rpc("staff_names"),
  ]);
  const orders: HandedOrder[] = ordersResult.data ?? [];
  const total = ordersResult.count ?? 0;
  const pages = searching ? 1 : Math.max(1, Math.ceil(total / pageSize));
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
        <div className="handed-heading">
          <div className="admin-card-heading">{searching
            ? <><h2>Rezultate pentru „{query}”</h2><p>{total} {total === 1 ? "comandă găsită" : "comenzi găsite"} printre toate comenzile predate. <Link href={`/orders/handed?${rangeQuery}`}>Șterge căutarea</Link></p></>
            : <><h2>Predate curierului</h2><p>{total} {total === 1 ? "comandă predată" : "comenzi predate"} în intervalul ales.</p></>}</div>
          <form action="/orders/handed" method="get" className="handed-search" role="search">
            {range.preset === "custom" ? <><input type="hidden" name="range" value="custom"/><input type="hidden" name="from" value={range.fromDay}/><input type="hidden" name="to" value={range.toDay}/></>
              : <input type="hidden" name="range" value={range.preset}/>}
            <input type="search" name="q" defaultValue={query} minLength={3} maxLength={120} placeholder="Factură, comandă, client, email, telefon…" aria-label="Caută o comandă predată" autoComplete="off"/>
            <button className="button button-primary" type="submit">Caută</button>
          </form>
        </div>
        {query && !searching && <p className="admin-empty-note">Introdu cel puțin 3 caractere.</p>}
        {ordersResult.error || searchResult?.error ? <p className="notice error search-notice" role="alert">Comenzile nu pot fi încărcate acum. Reîncarcă pagina.</p>
          : orders.length === 0 ? <p className="admin-empty-note">{searching ? "Nicio comandă predată nu se potrivește căutării." : "Nicio comandă predată în acest interval."}</p>
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
