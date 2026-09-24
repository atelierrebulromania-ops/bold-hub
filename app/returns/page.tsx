import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { OrderResultCard, SearchForm } from "@/components/order-result";
import { requireRole } from "@/lib/auth";
import { resolveRange, type RangePreset } from "@/lib/dashboard-range";
import { returnReasonLabels, type OrderSearchResult, type ReturnReason } from "@/lib/orders";
import { registerReturn } from "./actions";
import { ReturnsHistoryTable, type ReturnHistoryRow } from "./history-table";
import { ReturnsBoard, type ReturnRow } from "./returns-board";

export const dynamic = "force-dynamic";

const notices: Record<string, string> = {
  registered: "Returul a fost înregistrat. Depozitul a fost notificat pentru verificarea fizică.",
};

const errors: Record<string, string> = {
  invalid: "Selecția nu este validă. Reîncarcă pagina.",
  not_returnable: "Doar comenzile predate curierului pot fi înregistrate ca retur, o singură dată.",
  already_done: "Operațiunea a fost deja făcută sau nu se aplică acestui retur.",
  save_failed: "Nu am putut salva. Reîncarcă pagina și încearcă din nou.",
};

const reasons = Object.entries(returnReasonLabels) as [ReturnReason, string][];

const historyPageSize = 50;

const presets: { value: Exclude<RangePreset, "custom">; label: string }[] = [
  { value: "today", label: "Azi" },
  { value: "7d", label: "7 zile" },
  { value: "30d", label: "30 zile" },
  { value: "month", label: "Luna curentă" },
];

const outcomes = [
  { value: "all", label: "Toate" },
  { value: "ok", label: "Procesate cu succes" },
  { value: "remarks", label: "Cu mențiuni" },
] as const;

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
  searchParams: Promise<{ tab?: string; q?: string; notice?: string; error?: string; range?: string; from?: string; to?: string; page?: string; outcome?: string }>;
}) {
  const { supabase, profile } = await requireRole(["admin", "operator_depozit", "operator_facturare"]);
  const params = await searchParams;
  const canRegister = profile.role === "admin" || profile.role === "operator_facturare";
  const canRestock = profile.role === "admin" || profile.role === "operator_depozit";
  const isAdmin = profile.role === "admin";
  const tab = params.tab === "history" ? "history" : "pending";
  const query = (params.q ?? "").trim().slice(0, 120);
  const searched = tab === "pending" && canRegister && query.length >= 3;

  // History tab: processed returns in the chosen interval, or a search across all of them.
  const range = resolveRange({ range: params.range ?? "30d", from: params.from, to: params.to });
  const outcome = outcomes.find((item) => item.value === params.outcome)?.value ?? "all";
  const historyTerm = tab === "history" ? query.replace(/[^\p{L}\p{N}\s+\-#./@]/gu, " ").trim() : "";
  const historySearch = historyTerm.length >= 3;
  const historyPage = Math.max(1, Number.parseInt(params.page ?? "1", 10) || 1);

  const reportStart = new Date();
  reportStart.setMonth(reportStart.getMonth() - 5, 1);
  reportStart.setHours(0, 0, 0, 0);
  const returnFields = "id,reason,status,registered_at,restocked_at,restock_note,shopify_marked_manually,online_orders(invoice_number,bocp_order_id,source,customer_name,customer_phone,shipping_address,completed_at,online_order_items(id,quantity,products(name,sku,variant_label)))" as const;
  // Admin only: Shopify returns still to mark by hand, whether or not the warehouse processed them.
  const shopifyFields = "id,reason,status,registered_at,restocked_at,restock_note,shopify_marked_manually,online_orders!inner(invoice_number,bocp_order_id,source,customer_name,customer_phone,shipping_address,completed_at,online_order_items(id,quantity,products(name,sku,variant_label)))" as const;

  const historyQuery = () => {
    let request = supabase.from("order_returns")
      .select("id,reason,registered_at,restocked_at,restocked_by,restock_note,restocked_with_remarks,online_orders!inner(invoice_number,bocp_order_id,source,customer_name,customer_phone,shipping_address,completed_at,online_order_items(id,quantity,products(name,sku,variant_label)))", { count: "exact" })
      .eq("status", "restocked");
    if (historySearch) {
      const like = `*${historyTerm}*`;
      request = request.or(["invoice_number", "bocp_order_id", "customer_name", "customer_phone", "customer_email"]
        .map((column) => `${column}.ilike.${like}`).join(","), { referencedTable: "online_orders" });
    } else {
      request = request.gte("restocked_at", range.from.toISOString()).lt("restocked_at", range.to.toISOString());
    }
    if (outcome !== "all") request = request.eq("restocked_with_remarks", outcome === "remarks");
    const offset = historySearch ? 0 : (historyPage - 1) * historyPageSize;
    return request.order("restocked_at", { ascending: false }).range(offset, offset + historyPageSize - 1);
  };
  const history = tab === "history";

  const [searchResult, pendingResult, shopifyResult, reportResult, handedResult, historyResult, staffResult] = await Promise.all([
    searched ? supabase.rpc("search_online_orders", { p_query: query }) : Promise.resolve(null),
    supabase.from("order_returns").select(returnFields).eq("status", "pending_restock")
      .order("registered_at", { ascending: true }).limit(200),
    isAdmin && !history ? supabase.from("order_returns").select(shopifyFields)
      .eq("shopify_marked_manually", false).eq("online_orders.source", "shopify")
      .order("registered_at", { ascending: true }).limit(200) : Promise.resolve(null),
    isAdmin && history ? supabase.from("order_returns").select("reason,registered_at")
      .gte("registered_at", reportStart.toISOString()).limit(10000) : Promise.resolve(null),
    isAdmin && history ? supabase.from("online_orders").select("completed_at")
      .in("status", ["handed_to_courier", "returned"]).gte("completed_at", reportStart.toISOString()).limit(50000) : Promise.resolve(null),
    history ? historyQuery() : Promise.resolve(null),
    history ? supabase.rpc("staff_names") : Promise.resolve(null),
  ]);
  const loadError = [pendingResult, shopifyResult, reportResult, handedResult].some(result => result?.error);
  const historyRows: ReturnHistoryRow[] = historyResult?.data ?? [];
  const historyTotal = historyResult?.count ?? 0;
  const historyPages = historySearch ? 1 : Math.max(1, Math.ceil(historyTotal / historyPageSize));
  const names = Object.fromEntries((staffResult?.data ?? []).map((user) => [user.id, user.full_name]));
  const rangeQuery = range.preset === "custom" ? `range=custom&from=${range.fromDay}&to=${range.toDay}` : `range=${range.preset}`;
  const outcomeQuery = outcome === "all" ? "" : `&outcome=${outcome}`;
  const historyHref = (extra: string) => `/returns?tab=history&${extra}`;
  const orders = (searchResult?.data ?? []) as OrderSearchResult[];
  const pending: ReturnRow[] = pendingResult.data ?? [];
  const shopifyPending: ReturnRow[] = shopifyResult?.data ?? [];

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
      {params.notice && notices[params.notice] && <p className="preview-alert success admin-feedback" role="status">{notices[params.notice]}</p>}
      {params.error && errors[params.error] && <p className="notice error admin-feedback" role="alert">{errors[params.error]}</p>}
      {loadError && <p className="notice error admin-feedback" role="alert">O parte din date nu poate fi încărcată acum.</p>}

      <section className="board-panel" aria-label="Retururi">
        <div className="panel-tabs-row">
          <h2 className="panel-tabs-title">{tab === "pending" ? "De procesat" : "Istoric"}</h2>
          <nav className="board-tabs panel-tabs" aria-label="Vedere">
            <Link href="/returns" className={tab === "pending" ? "active" : ""} aria-current={tab === "pending" ? "page" : undefined}>De procesat <span>{pending.length}</span></Link>
            <Link href="/returns?tab=history" className={tab === "history" ? "active" : ""} aria-current={tab === "history" ? "page" : undefined}>Istoric</Link>
          </nav>
          <span aria-hidden="true" />
        </div>

      {tab === "pending" ? <>
        {canRegister && <section className="panel-section" aria-labelledby="register-title">
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
                  {isAdmin && order.source === "shopify" && <label className="admin-checkbox"><input type="checkbox" name="shopify_marked"/> Marcat deja „returned” în Shopify</label>}
                  <button className="button button-primary" type="submit">Înregistrează retur</button>
                </form>
                : !order.return && <p className="admin-empty-inline result-action">Comanda nu a fost încă predată curierului, deci nu poate fi retur.</p>}
            </OrderResultCard>)}
          </div>}
        </section>}
  
        <section className="panel-section" aria-labelledby="pending-title">
          {/* The tab already says "De procesat"; the heading only separates it from the other sections. */}
          {(canRegister || isAdmin) ? <div className="admin-card-heading"><h2 id="pending-title">Retururi înregistrate</h2><p>Așteaptă verificarea în depozit.</p></div>
            : <h2 id="pending-title" className="sr-only">De procesat</h2>}
          <ReturnsBoard returns={pending} canProcess={canRestock} canMarkShopify={false} empty="Nu există retururi de procesat." />
        </section>
  
        {isAdmin && <section className="panel-section" aria-labelledby="shopify-title">
          <div className="admin-card-heading"><h2 id="shopify-title">De marcat în Shopify</h2><p>Retururile comenzilor Shopify care trebuie marcate manual „returned” în Shopify.</p></div>
          <ReturnsBoard returns={shopifyPending} canProcess={false} canMarkShopify empty="Toate retururile Shopify sunt marcate." />
        </section>}
      </> : <>
        <div className="board-panel-heading partners-heading">
          <div className="partners-heading-start">
            <div className="dashboard-presets" role="group" aria-label="Rezultat">{outcomes.map(item => <Link key={item.value}
              href={historyHref(`${rangeQuery}${item.value === "all" ? "" : `&outcome=${item.value}`}${historySearch ? `&q=${encodeURIComponent(query)}` : ""}`)}
              className={outcome === item.value ? "preset active" : "preset"} aria-current={outcome === item.value ? "true" : undefined}>{item.label}</Link>)}</div>
          </div>
          <div className="partners-heading-end">
            <form action="/returns" method="get" className="handed-search" role="search">
              <input type="hidden" name="tab" value="history"/>
              {range.preset === "custom" ? <><input type="hidden" name="range" value="custom"/><input type="hidden" name="from" value={range.fromDay}/><input type="hidden" name="to" value={range.toDay}/></>
                : <input type="hidden" name="range" value={range.preset}/>}
              {outcome !== "all" && <input type="hidden" name="outcome" value={outcome}/>}
              <input type="search" name="q" defaultValue={query} minLength={3} maxLength={120} placeholder="Factură, comandă, client, telefon…" aria-label="Caută în istoricul retururilor" autoComplete="off"/>
              <button className="button button-primary" type="submit">Caută</button>
            </form>
          </div>
        </div>
        <div className="history-bar">
          <div className="dashboard-presets" role="group" aria-label="Interval">{presets.map(preset => <Link key={preset.value} href={historyHref(`range=${preset.value}${outcomeQuery}`)}
            className={!historySearch && range.preset === preset.value ? "preset active" : "preset"} aria-current={!historySearch && range.preset === preset.value ? "true" : undefined}>{preset.label}</Link>)}</div>
          <form action="/returns" method="get" className="dashboard-custom">
            <input type="hidden" name="tab" value="history"/><input type="hidden" name="range" value="custom"/>
            {outcome !== "all" && <input type="hidden" name="outcome" value={outcome}/>}
            <label>De la <input type="date" name="from" defaultValue={range.fromDay} required/></label>
            <label>Până la <input type="date" name="to" defaultValue={range.toDay} required/></label>
            <button type="submit" className={!historySearch && range.preset === "custom" ? "button button-primary" : "button button-outline"}>Aplică</button>
          </form>
          <p className="history-count">{historySearch
            ? <>{historyTotal} {historyTotal === 1 ? "retur găsit" : "retururi găsite"} pentru „{historyTerm}” în tot istoricul · <Link href={historyHref(`${rangeQuery}${outcomeQuery}`)}>Șterge căutarea</Link></>
            : <>{historyTotal} {historyTotal === 1 ? "retur procesat" : "retururi procesate"} în intervalul ales</>}</p>
        </div>
        <section aria-label="Retururi procesate">
          {query && !historySearch && <p className="admin-empty-note">Introdu cel puțin 3 caractere.</p>}
          {historyResult?.error ? <p className="notice error search-notice" role="alert">Istoricul nu poate fi încărcat acum. Reîncarcă pagina.</p>
            : historyRows.length === 0 ? <p className="admin-empty-note">{historySearch ? "Niciun retur procesat nu se potrivește căutării." : "Niciun retur procesat în acest interval."}</p>
            : <ReturnsHistoryTable rows={historyRows} operatorNames={names} />}
          {historyPages > 1 && <nav className="pager" aria-label="Pagini">
            {historyPage > 1 ? <Link className="button button-outline" href={historyHref(`${rangeQuery}${outcomeQuery}&page=${historyPage - 1}`)}>← Înapoi</Link> : <span />}
            <span className="result-count">Pagina {historyPage} din {historyPages}</span>
            {historyPage < historyPages ? <Link className="button button-outline" href={historyHref(`${rangeQuery}${outcomeQuery}&page=${historyPage + 1}`)}>Înainte →</Link> : <span />}
          </nav>}
        </section>

        {isAdmin && <section className="panel-section" aria-labelledby="report-title">
          <div className="admin-card-heading"><h2 id="report-title">Raport lunar</h2><p>Retururi înregistrate pe lună, pe motive, raportate la comenzile predate în aceeași lună.</p></div>
          <div className="preview-table-wrap report-table"><table>
            <thead><tr><th>Luna</th>{reasons.map(([value, label]) => <th key={value}>{label}</th>)}<th>Total retururi</th><th>Predate</th><th>Rată retur</th></tr></thead>
            <tbody>{[...months].reverse().map(month => {
              const entry = report.get(month)!;
              return <tr key={month}><td>{monthLabel(month)}</td>{reasons.map(([value]) => <td key={value}>{entry.reasons[value] ?? 0}</td>)}<td>{entry.total}</td><td>{entry.handed}</td><td>{entry.handed ? `${(entry.total / entry.handed * 100).toFixed(1)}%` : "—"}</td></tr>;
            })}</tbody>
          </table></div>
        </section>}
      </>}
      </section>
    </AppShell>
  );
}
