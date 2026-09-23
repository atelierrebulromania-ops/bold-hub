import { AppShell } from "@/components/app-shell";
import { OrderResultCard, SearchForm } from "@/components/order-result";
import { requireRole } from "@/lib/auth";
import { formatDateTime, returnReasonLabels, type OrderSearchResult, type ReturnReason } from "@/lib/orders";
import { confirmRestock, markShopify, registerReturn } from "./actions";

export const dynamic = "force-dynamic";

const notices: Record<string, string> = {
  registered: "Returul a fost înregistrat. Depozitul a fost notificat pentru verificarea fizică.",
  restocked: "Verificarea fizică a fost confirmată. Produsele pot reveni în stoc în BOCP.",
  shopify_marked: "Returul a fost marcat ca actualizat în Shopify.",
};

const errors: Record<string, string> = {
  invalid: "Selecția nu este validă. Reîncarcă pagina.",
  not_returnable: "Doar comenzile predate curierului pot fi înregistrate ca retur, o singură dată.",
  already_done: "Operațiunea a fost deja făcută sau nu se aplică acestui retur.",
  save_failed: "Nu am putut salva. Reîncarcă pagina și încearcă din nou.",
};

const reasons = Object.entries(returnReasonLabels) as [ReturnReason, string][];

function monthKey(value: string) {
  return new Date(value).toLocaleDateString("sv-SE", { timeZone: "Europe/Bucharest" }).slice(0, 7);
}

function monthLabel(key: string) {
  const [year, month] = key.split("-").map(Number);
  return new Intl.DateTimeFormat("ro-RO", { month: "long", year: "numeric" }).format(new Date(year, month - 1, 15));
}

export default async function ReturnsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; notice?: string; error?: string }>;
}) {
  const { supabase, profile } = await requireRole(["admin", "operator_depozit", "operator_facturare"]);
  const params = await searchParams;
  const canRegister = profile.role === "admin" || profile.role === "operator_facturare";
  const canRestock = profile.role === "admin" || profile.role === "operator_depozit";
  const isAdmin = profile.role === "admin";
  const query = (params.q ?? "").trim().slice(0, 120);
  const searched = canRegister && query.length >= 3;

  const reportStart = new Date();
  reportStart.setMonth(reportStart.getMonth() - 5, 1);
  reportStart.setHours(0, 0, 0, 0);
  const recentStart = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const returnFields = "id,reason,status,registered_at,restocked_at,shopify_marked_manually,online_orders(invoice_number,source,customer_name,online_order_items(quantity,products(name,sku,variant_label)))" as const;

  const [searchResult, pendingResult, recentResult, reportResult, handedResult] = await Promise.all([
    searched ? supabase.rpc("search_online_orders", { p_query: query }) : Promise.resolve(null),
    supabase.from("order_returns").select(returnFields).eq("status", "pending_restock")
      .order("registered_at", { ascending: true }).limit(200),
    supabase.from("order_returns").select(returnFields).eq("status", "restocked")
      .gte("restocked_at", recentStart).order("restocked_at", { ascending: false }).limit(50),
    isAdmin ? supabase.from("order_returns").select("reason,registered_at")
      .gte("registered_at", reportStart.toISOString()).limit(10000) : Promise.resolve(null),
    isAdmin ? supabase.from("online_orders").select("completed_at")
      .in("status", ["handed_to_courier", "returned"]).gte("completed_at", reportStart.toISOString()).limit(50000) : Promise.resolve(null),
  ]);
  const loadError = [pendingResult, recentResult, reportResult, handedResult].some(result => result?.error);
  const orders = (searchResult?.data ?? []) as OrderSearchResult[];
  const pending = pendingResult.data ?? [];
  const recent = recentResult.data ?? [];

  const months: string[] = [];
  for (let offset = 0; offset < 6; offset++) {
    const date = new Date(reportStart);
    date.setMonth(reportStart.getMonth() + offset);
    months.push(monthKey(new Date(date.getFullYear(), date.getMonth(), 15).toISOString()));
  }
  const report = new Map(months.map(month => [month, { total: 0, handed: 0, reasons: {} as Partial<Record<ReturnReason, number>> }]));
  for (const row of reportResult?.data ?? []) {
    const entry = report.get(monthKey(row.registered_at));
    if (!entry) continue;
    entry.total += 1;
    entry.reasons[row.reason] = (entry.reasons[row.reason] ?? 0) + 1;
  }
  for (const row of handedResult?.data ?? []) {
    const entry = row.completed_at ? report.get(monthKey(row.completed_at)) : undefined;
    if (entry) entry.handed += 1;
  }

  return (
    <AppShell profile={profile} active="/returns" section="Operațiuni" title="Retururi"
      note={{ title: "Stoc BOCP", text: "După verificare, stocul se actualizează în BOCP." }}>
      <div className="page-heading"><div><p className="eyebrow">RETURURI</p><h1>Retururi</h1><p className="muted">{canRegister ? "Înregistrează comenzile întoarse, apoi depozitul confirmă verificarea fizică." : "Verifică fizic produsele întoarse înainte să revină ca disponibile."}</p></div><span className="page-heading-chip preview-chip">{pending.length} de verificat</span></div>
      {params.notice && notices[params.notice] && <p className="preview-alert success admin-feedback" role="status">{notices[params.notice]}</p>}
      {params.error && errors[params.error] && <p className="notice error admin-feedback" role="alert">{errors[params.error]}</p>}
      {loadError && <p className="notice error admin-feedback" role="alert">O parte din date nu poate fi încărcată acum.</p>}

      {canRegister && <section className="admin-card" aria-labelledby="register-title">
        <div className="admin-card-heading"><h2 id="register-title">Înregistrează retur</h2><p>Caută comanda după numărul facturii sau al comenzii. Doar comenzile predate curierului pot deveni retur.</p></div>
        <SearchForm action="/returns" query={query} placeholder="Ex. AR1234 sau #1045"/>
        {query && !searched && <p className="admin-empty-note">Introdu cel puțin 3 caractere.</p>}
        {searchResult?.error && <p className="notice error search-notice" role="alert">Căutarea nu a putut fi făcută. Încearcă din nou.</p>}
        {searched && !searchResult?.error && <div className="result-list">
          <p className="result-count">{orders.length} {orders.length === 1 ? "rezultat" : "rezultate"}</p>
          {orders.map(order => <OrderResultCard key={order.id} order={order}>
            {order.status === "handed_to_courier" && !order.return
              ? <form action={registerReturn} className="admin-inline admin-mini-form result-action">
                <input type="hidden" name="order_id" value={order.id}/>
                <input type="hidden" name="q" value={query}/>
                <select name="reason" defaultValue="neridicat" aria-label={`Motiv retur ${order.invoice_number}`}>{reasons.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
                {order.source === "shopify" && <label className="admin-checkbox"><input type="checkbox" name="shopify_marked"/> Marcat deja „returned” în Shopify</label>}
                <button className="button button-primary" type="submit">Înregistrează retur</button>
              </form>
              : !order.return && <p className="admin-empty-inline result-action">Comanda nu a fost încă predată curierului, deci nu poate fi retur.</p>}
          </OrderResultCard>)}
        </div>}
      </section>}

      <section className="admin-card reseller-list-section" aria-labelledby="pending-title">
        <div className="admin-card-heading"><h2 id="pending-title">De verificat fizic</h2><p>Produsele revin ca disponibile doar după o verificare minimă în depozit.</p></div>
        {pending.length === 0 ? <p className="admin-empty-note">Nu există retururi care așteaptă verificarea.</p> : <div className="reseller-list">
          {pending.map(item => <ReturnCard key={item.id} item={item} query={query}
            canRestock={canRestock} canMarkShopify={canRegister}/>)}
        </div>}
      </section>

      <section className="admin-card reseller-list-section" aria-labelledby="recent-title">
        <div className="admin-card-heading"><h2 id="recent-title">Verificate în ultimele 30 de zile</h2><p>Istoric scurt pentru confirmare.</p></div>
        {recent.length === 0 ? <p className="admin-empty-note">Niciun retur verificat recent.</p> : <div className="reseller-list">
          {recent.map(item => <ReturnCard key={item.id} item={item} query={query} canRestock={false} canMarkShopify={canRegister}/>)}
        </div>}
      </section>

      {isAdmin && <section className="admin-card reseller-list-section" aria-labelledby="report-title">
        <div className="admin-card-heading"><h2 id="report-title">Raport lunar</h2><p>Retururi înregistrate pe lună, pe motive, raportate la comenzile predate în aceeași lună.</p></div>
        <div className="preview-table-wrap report-table"><table>
          <thead><tr><th>Luna</th>{reasons.map(([value, label]) => <th key={value}>{label}</th>)}<th>Total retururi</th><th>Predate</th><th>Rată retur</th></tr></thead>
          <tbody>{[...months].reverse().map(month => {
            const entry = report.get(month)!;
            return <tr key={month}><td>{monthLabel(month)}</td>{reasons.map(([value]) => <td key={value}>{entry.reasons[value] ?? 0}</td>)}<td>{entry.total}</td><td>{entry.handed}</td><td>{entry.handed ? `${(entry.total / entry.handed * 100).toFixed(1)}%` : "—"}</td></tr>;
          })}</tbody>
        </table></div>
      </section>}
    </AppShell>
  );
}

type ReturnRow = {
  id: string;
  reason: ReturnReason;
  status: "pending_restock" | "restocked";
  registered_at: string;
  restocked_at: string | null;
  shopify_marked_manually: boolean;
  online_orders: {
    invoice_number: string;
    source: "shopify" | "marketplace";
    customer_name: string | null;
    online_order_items: { quantity: number; products: { name: string; sku: string; variant_label: string | null } | null }[];
  } | null;
};

function ReturnCard({ item, query, canRestock, canMarkShopify }: { item: ReturnRow; query: string; canRestock: boolean; canMarkShopify: boolean }) {
  const order = item.online_orders;
  const needsShopify = order?.source === "shopify" && !item.shopify_marked_manually;
  return (
    <article className="reseller-card">
      <div className="reseller-card-heading">
        <div>
          <h3>{order?.invoice_number ?? "Comandă"}</h3>
          <p>{order?.customer_name ?? "—"} · {returnReasonLabels[item.reason]}</p>
          <small>Înregistrat {formatDateTime(item.registered_at)}{item.restocked_at ? ` · verificat ${formatDateTime(item.restocked_at)}` : ""}</small>
        </div>
        <div className="reseller-tags">
          {order && <span className={`source-tag ${order.source}`}>{order.source === "shopify" ? "Shopify" : "Marketplace"}</span>}
          {needsShopify && <span className="reseller-tag important">Nemarcat în Shopify</span>}
        </div>
      </div>
      {order && order.online_order_items.length > 0 && <ul className="par-list return-items">{order.online_order_items.map((line, index) => <li key={index}>
        <span>{line.products?.name ?? "Produs"}{line.products?.variant_label ? ` · ${line.products.variant_label}` : ""}<small>SKU {line.products?.sku ?? "—"}</small></span>
        <strong>×{line.quantity}</strong>
      </li>)}</ul>}
      {(canRestock && item.status === "pending_restock") || (canMarkShopify && needsShopify) ? <div className="return-actions">
        {canRestock && item.status === "pending_restock" && <form action={confirmRestock}>
          <input type="hidden" name="return_id" value={item.id}/><input type="hidden" name="q" value={query}/>
          <button className="button button-primary" type="submit">Confirmă verificarea fizică</button>
        </form>}
        {canMarkShopify && needsShopify && <form action={markShopify}>
          <input type="hidden" name="return_id" value={item.id}/><input type="hidden" name="q" value={query}/>
          <button className="button button-outline" type="submit">Am marcat „returned” în Shopify</button>
        </form>}
      </div> : null}
    </article>
  );
}
