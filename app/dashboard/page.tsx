import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { requireRole } from "@/lib/auth";
import { resolveRange, type RangePreset } from "@/lib/dashboard-range";
import { formatDateTime, returnReasonLabels, type ReturnReason } from "@/lib/orders";

export const dynamic = "force-dynamic";

type Summary = {
  online: { created: number; handed: number; handed_shopify: number; handed_marketplace: number; open_now: number; waiting_now: number; avg_prep_minutes: number | null; avg_total_hours: number | null };
  operators: { name: string; handed: number }[];
  returns: { registered: number; pending_restock_now: number; by_reason: Partial<Record<ReturnReason, number>> };
  refill: { open_carts: number; overdue_carts: number; pending_deliveries: number; awaiting_invoice: number; fulfillments_delivered: number; top_resellers: { name: string; location: string; units: number }[] };
  stock: { tracked_products: number; bocp_units: number; reserved_units: number; over_reserved_products: number; last_sync: string | null };
  daily: { day: string; created: number; handed: number }[];
};

const presets: { value: Exclude<RangePreset, "custom">; label: string }[] = [
  { value: "today", label: "Azi" },
  { value: "7d", label: "7 zile" },
  { value: "30d", label: "30 zile" },
  { value: "month", label: "Luna curentă" },
];

const number = new Intl.NumberFormat("ro-RO");

function dayLabel(day: string) {
  return new Intl.DateTimeFormat("ro-RO", { day: "2-digit", month: "short", timeZone: "UTC" }).format(new Date(`${day}T12:00:00Z`));
}

function Stat({ label, value, hint }: { label: string; value: string; hint: string }) {
  return <div className="stat-card dashboard-stat"><div><p>{label}</p><strong>{value}</strong><small>{hint}</small></div></div>;
}

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string; from?: string; to?: string }>;
}) {
  const { supabase, profile } = await requireRole(["admin", "owner"]);
  const range = resolveRange(await searchParams);
  const { data, error } = await supabase.rpc("dashboard_summary", {
    p_from: range.from.toISOString(),
    p_to: range.to.toISOString(),
  });
  const summary = data as Summary | null;

  return (
    <AppShell profile={profile} active="/dashboard" section="Monitorizare" title="Dashboard"
      note={{ title: "Doar vizualizare", text: "Dashboard-ul nu modifică nimic în operațiuni." }}>
      <div className="page-heading"><div><p className="eyebrow">MONITORIZARE</p><h1>Dashboard</h1><p className="muted">Activitatea depozitului: {dayLabel(range.fromDay)} – {dayLabel(range.toDay)}</p></div><span className="page-heading-chip preview-chip">Doar citire</span></div>

      <div className="dashboard-filters" role="group" aria-label="Interval">
        <div className="dashboard-presets">{presets.map(preset => <Link key={preset.value} href={`/dashboard?range=${preset.value}`}
          className={range.preset === preset.value ? "preset active" : "preset"} aria-current={range.preset === preset.value ? "true" : undefined}>{preset.label}</Link>)}</div>
        <form action="/dashboard" method="get" className="dashboard-custom">
          <input type="hidden" name="range" value="custom"/>
          <label>De la <input type="date" name="from" defaultValue={range.fromDay} required/></label>
          <label>Până la <input type="date" name="to" defaultValue={range.toDay} required/></label>
          <button type="submit" className={range.preset === "custom" ? "button button-primary" : "button button-outline"}>Aplică</button>
        </form>
      </div>

      {error || !summary ? <p className="notice error" role="alert">Indicatorii nu pot fi încărcați acum.</p> : <>
        <h2 className="dashboard-section-title">Comenzi online</h2>
        <div className="stat-grid">
          <Stat label="Comenzi noi" value={number.format(summary.online.created)} hint="importate în interval"/>
          <Stat label="Predate curierului" value={number.format(summary.online.handed)} hint={`${summary.online.handed_shopify} Shopify · ${summary.online.handed_marketplace} marketplace`}/>
          <Stat label="Timp mediu pregătire" value={summary.online.avg_prep_minutes === null ? "—" : `${summary.online.avg_prep_minutes} min`} hint="de la preluare la predare"/>
          <Stat label="De la import la predare" value={summary.online.avg_total_hours === null ? "—" : `${String(summary.online.avg_total_hours).replace(".", ",")} h`} hint="medie pe comenzile predate"/>
        </div>

        <div className="dashboard-grid">
          <section className="admin-card">
            <div className="admin-card-heading"><h2>Comenzi predate pe zi</h2><p>Acum pe board: {summary.online.open_now} deschise, dintre care {summary.online.waiting_now} nepreluate.</p></div>
            <DailyChart daily={summary.daily}/>
          </section>
          <section className="admin-card">
            <div className="admin-card-heading"><h2>Volum per operator</h2><p>Comenzi predate în interval.</p></div>
            {summary.operators.length === 0 ? <p className="admin-empty-note">Nicio comandă predată în interval.</p>
              : <ul className="admin-simple-list dashboard-list">{summary.operators.map(operator => <li key={operator.name}><span>{operator.name}</span><strong>{number.format(operator.handed)}</strong></li>)}</ul>}
          </section>
        </div>

        <h2 className="dashboard-section-title">Retururi</h2>
        <div className="stat-grid">
          <Stat label="Retururi înregistrate" value={number.format(summary.returns.registered)} hint="în interval"/>
          <Stat label="Rată retur" value={summary.online.handed ? `${(summary.returns.registered / summary.online.handed * 100).toFixed(1).replace(".", ",")}%` : "—"} hint="față de comenzile predate"/>
          <Stat label="Așteaptă verificarea" value={number.format(summary.returns.pending_restock_now)} hint="acum, în depozit"/>
          <Stat label="Cel mai frecvent motiv" value={topReason(summary.returns.by_reason)} hint="în interval"/>
        </div>

        <h2 className="dashboard-section-title">Revânzători & stoc</h2>
        <div className="stat-grid">
          <Stat label="Coșuri active" value={number.format(summary.refill.open_carts)} hint={`${summary.refill.overdue_carts} peste 48h fără livrare`}/>
          <Stat label="Livrări de confirmat" value={number.format(summary.refill.pending_deliveries)} hint={`${summary.refill.awaiting_invoice} așteaptă factura`}/>
          <Stat label="Stoc rezervat" value={number.format(summary.stock.reserved_units)} hint={`din ${number.format(summary.stock.bocp_units)} buc. în BOCP`}/>
          <Stat label="Discrepanțe stoc" value={number.format(summary.stock.over_reserved_products)} hint={summary.stock.last_sync ? `rezervat > BOCP · sync ${formatDateTime(summary.stock.last_sync)}` : "stocul BOCP nu e sincronizat încă"}/>
        </div>
        <section className="admin-card reseller-list-section">
          <div className="admin-card-heading"><h2>Top revânzători după volum</h2><p>Bucăți cerute în coș în interval. Livrări finalizate: {summary.refill.fulfillments_delivered}.</p></div>
          {summary.refill.top_resellers.length === 0 ? <p className="admin-empty-note">Nicio cerere de refill în interval.</p>
            : <ul className="admin-simple-list dashboard-list">{summary.refill.top_resellers.map(reseller => <li key={`${reseller.name}-${reseller.location}`}><span>{reseller.name}<small>{reseller.location}</small></span><strong>{number.format(reseller.units)} buc.</strong></li>)}</ul>}
        </section>
      </>}
    </AppShell>
  );
}

function topReason(byReason: Partial<Record<ReturnReason, number>>) {
  const top = (Object.entries(byReason) as [ReturnReason, number][]).sort((a, b) => b[1] - a[1])[0];
  return top ? returnReasonLabels[top[0]] : "—";
}

function DailyChart({ daily }: { daily: Summary["daily"] }) {
  const max = Math.max(1, ...daily.map(day => day.handed));
  const labelEvery = Math.ceil(daily.length / 8);
  return (
    <div className="daily-chart-wrap">
      <div className="daily-chart" role="img" aria-label={`Comenzi predate pe zi, maximum ${max} într-o zi`}>
        <div className="daily-chart-axis" aria-hidden="true"><span>{max}</span><span>0</span></div>
        <div className="daily-chart-bars">
          {daily.map((day, index) => <div className="daily-bar-slot" key={day.day} tabIndex={0}
            title={`${dayLabel(day.day)}: ${day.handed} predate · ${day.created} noi`}>
            <div className="daily-bar" style={{ height: `${day.handed / max * 100}%` }}/>
            <span className="daily-bar-tip" aria-hidden="true">{dayLabel(day.day)}<b>{day.handed} predate</b>{day.created} noi</span>
            <span className="daily-bar-label" aria-hidden="true">{index % labelEvery === 0 ? dayLabel(day.day) : ""}</span>
          </div>)}
        </div>
      </div>
      <details className="daily-table">
        <summary>Vezi ca tabel</summary>
        <div className="preview-table-wrap"><table>
          <thead><tr><th>Ziua</th><th>Comenzi noi</th><th>Predate</th></tr></thead>
          <tbody>{daily.map(day => <tr key={day.day}><td>{dayLabel(day.day)}</td><td>{day.created}</td><td>{day.handed}</td></tr>)}</tbody>
        </table></div>
      </details>
    </div>
  );
}
