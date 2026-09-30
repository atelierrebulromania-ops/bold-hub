import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { LinkPending } from "@/components/link-pending";
import { requireRole } from "@/lib/auth";
import { resolveRange, type RangePreset } from "@/lib/dashboard-range";
import { formatMoney } from "@/lib/pricing";

export const dynamic = "force-dynamic";

type Activity = {
  warehouse: { name: string; online_prepared: number; avg_prep_minutes: number | null; b2b_shelved: number; b2b_handed: number; returns_checked: number; returns_with_remarks: number }[];
  agents: { name: string; new_clients: number; offers: number; offers_to_proforma: number; offers_invoiced: number; proformas: number;
    invoiced_value: number; invoices: number; outstanding: number; overdue: number }[];
  inactive_days: number;
  inactive_clients: { name: string; location: string; agent: string | null; last_request: string | null }[];
  overdue: { count: number; amount: number };
};

const presets: { value: Exclude<RangePreset, "custom">; label: string }[] = [
  { value: "today", label: "Azi" },
  { value: "7d", label: "7 zile" },
  { value: "30d", label: "30 zile" },
  { value: "month", label: "Luna curentă" },
];

const number = new Intl.NumberFormat("ro-RO");

function minutes(value: number | null) {
  if (value === null) return "—";
  return value < 60 ? `${value} min` : `${Math.floor(value / 60)} h ${value % 60} min`;
}

function percent(part: number, whole: number) {
  return whole ? `${Math.round((part / whole) * 100)}%` : "—";
}

function dayLabel(day: string) {
  return new Intl.DateTimeFormat("ro-RO", { day: "2-digit", month: "short", timeZone: "UTC" }).format(new Date(`${day}T12:00:00Z`));
}

export default async function TeamActivityPage({ searchParams }: { searchParams: Promise<{ range?: string; from?: string; to?: string }> }) {
  const { supabase, profile } = await requireRole(["owner"]);
  const params = await searchParams;
  const range = resolveRange(params);
  const inactiveDays = 30;
  const { data, error } = await supabase.rpc("team_activity", { p_from: range.from.toISOString(), p_to: range.to.toISOString(), p_inactive_days: inactiveDays });
  const activity = data as Activity | null;
  const query = (extra: Record<string, string>) => {
    const values = new URLSearchParams({ range: range.preset, ...(range.preset === "custom" ? { from: range.fromDay, to: range.toDay } : {}), ...extra });
    return `/dashboard/team?${values}`;
  };

  return (
    <AppShell profile={profile} active="/dashboard/team" section="Monitorizare" title="Activitate echipă"
      note={{ title: "Doar vizualizare", text: "Cifrele vin din acțiunile făcute în aplicație de fiecare om." }}>
      <div className="page-heading"><div><p className="eyebrow">MONITORIZARE</p><h1>Activitate echipă</h1><p className="muted">{dayLabel(range.fromDay)} – {dayLabel(range.toDay)}</p></div></div>

      <div className="dashboard-filters" role="group" aria-label="Interval">
        <div className="dashboard-presets">{presets.map(preset => <Link key={preset.value} href={query({ range: preset.value })}
          className={range.preset === preset.value ? "preset active" : "preset"} aria-current={range.preset === preset.value ? "true" : undefined}>{preset.label}<LinkPending /></Link>)}</div>
      </div>

      {error || !activity ? <p className="notice error" role="alert">Activitatea nu poate fi încărcată acum.</p> : <>
        {activity.overdue.count > 0 && <Link className="overdue-banner" href="/dashboard/receivables">
          <strong>{number.format(activity.overdue.count)} {activity.overdue.count === 1 ? "factură depășită" : "facturi depășite"} · {formatMoney(activity.overdue.amount)} lei de încasat</strong>
          <span>Vezi facturile restante ›<LinkPending /></span>
        </Link>}

        <section className="board-panel team-section" aria-label="Depozit">
          <div className="receivables-heading"><h2>Depozit</h2></div>
          {activity.warehouse.length === 0 ? <p className="admin-empty-note">Nicio activitate în depozit în această perioadă.</p>
            : <div className="handed-table-wrap"><table className="handed-table team-table">
              <thead><tr><th>Operator</th><th>Comenzi online pregătite</th><th>Timp mediu pregătire</th><th>Retururi verificate</th><th>Cu mențiuni</th></tr></thead>
              <tbody>{activity.warehouse.map(row => <tr key={row.name}>
                <td className="strong">{row.name}</td>
                <td>{number.format(row.online_prepared)}</td>
                <td>{minutes(row.avg_prep_minutes)}</td>
                <td>{number.format(row.returns_checked)}</td>
                <td>{row.returns_with_remarks ? <span className="payment-chip soon">{number.format(row.returns_with_remarks)}</span> : "0"}</td>
              </tr>)}</tbody>
            </table></div>}
        </section>

        <section className="board-panel team-section" aria-label="Vânzări">
          <div className="receivables-heading"><h2>Vânzări</h2></div>
          {activity.agents.length === 0 ? <p className="admin-empty-note">Nu există agenți activi.</p>
            : <div className="handed-table-wrap"><table className="handed-table team-table">
              <thead><tr><th>Agent</th><th>Clienți noi</th><th>Oferte</th><th>→ proformă</th><th>→ factură</th><th>Proforme</th><th>Facturat</th><th>De încasat</th><th>Depășit</th></tr></thead>
              <tbody>{activity.agents.map(row => <tr key={row.name}>
                <td className="strong">{row.name}</td>
                <td>{number.format(row.new_clients)}</td>
                <td>{number.format(row.offers)}</td>
                <td>{number.format(row.offers_to_proforma)} <small className="muted">({percent(row.offers_to_proforma, row.offers)})</small></td>
                <td>{number.format(row.offers_invoiced)} <small className="muted">({percent(row.offers_invoiced, row.offers)})</small></td>
                <td>{number.format(row.proformas)}</td>
                <td className="nowrap"><strong>{formatMoney(row.invoiced_value)} lei</strong><small className="muted"> · {number.format(row.invoices)} {row.invoices === 1 ? "factură" : "facturi"}</small></td>
                <td className="nowrap">{formatMoney(row.outstanding)} lei</td>
                <td className="nowrap">{row.overdue > 0 ? <span className="payment-chip overdue">{formatMoney(row.overdue)} lei</span> : "—"}</td>
              </tr>)}</tbody>
            </table></div>}
          <p className="team-note">Conversia privește ofertele emise în perioadă. „Facturat” include facturile din depozit și cele emise direct din proformă; „de încasat” și „depășit” sunt la zi.</p>
        </section>

      </>}
    </AppShell>
  );
}
