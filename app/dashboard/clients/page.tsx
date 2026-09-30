import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { LinkPending } from "@/components/link-pending";
import { requireRole } from "@/lib/auth";
import { formatDateTime } from "@/lib/orders";
import { formatMoney } from "@/lib/pricing";

export const dynamic = "force-dynamic";

const types = [
  { value: "", label: "Toți" },
  { value: "horeca", label: "HoReCa" },
  { value: "reseller", label: "Revânzător" },
  { value: "altul", label: "Altul" },
] as const;
const typeLabel = (value: string) => types.find((type) => type.value === value)?.label ?? value;

const periods = [
  { value: "all", label: "Tot timpul" },
  { value: "30d", label: "30 zile" },
  { value: "month", label: "Luna curentă" },
  { value: "year", label: "Anul curent" },
] as const;
type Period = (typeof periods)[number]["value"];

// Start of the period in Bucharest time (null: since the beginning).
function periodStart(period: Period): Date | null {
  const today = new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Bucharest" }).format(new Date());
  if (period === "30d") { const date = new Date(`${today}T00:00:00`); date.setDate(date.getDate() - 29); return date; }
  if (period === "month") return new Date(`${today.slice(0, 7)}-01T00:00:00`);
  if (period === "year") return new Date(`${today.slice(0, 4)}-01-01T00:00:00`);
  return null;
}

const inactiveOptions = [14, 30, 60, 90];

const number = new Intl.NumberFormat("ro-RO");

export default async function OwnerClientsPage({ searchParams }: { searchParams: Promise<{ type?: string; period?: string; inactive?: string }> }) {
  const { supabase, profile } = await requireRole(["owner"]);
  const params = await searchParams;
  const type = types.some((item) => item.value === params.type) ? params.type ?? "" : "";
  const period: Period = periods.some((item) => item.value === params.period) ? params.period as Period : "all";
  const start = periodStart(period);
  const { data, error } = await supabase.rpc("owner_clients", { p_from: start?.toISOString() ?? null, p_to: null });
  const all = (data ?? []).filter((client) => client.active);
  const rows = all.filter((client) => !type || client.type === type).sort((a, b) => b.invoiced_value - a.invoiced_value || a.name.localeCompare(b.name, "ro"));
  const total = rows.reduce((sum, client) => sum + Number(client.invoiced_value), 0);
  const counts = Object.fromEntries(types.map((item) => [item.value, all.filter((client) => !item.value || client.type === item.value).length]));
  // Quiet clients: no request (or ever) in the last N days, all types — time for the agent to call.
  const inactiveDays = inactiveOptions.includes(Number(params.inactive)) ? Number(params.inactive) : 30;
  const quietSince = Date.now() - inactiveDays * 86_400_000;
  const inactive = all.filter((client) => !client.last_order || new Date(client.last_order).getTime() < quietSince)
    .sort((a, b) => (a.agent ?? "~").localeCompare(b.agent ?? "~", "ro") || (a.last_order ?? "").localeCompare(b.last_order ?? ""));
  const href = (next: { type?: string; period?: string; inactive?: number }) => {
    const values = new URLSearchParams();
    const t = next.type ?? type; const p = next.period ?? period; const i = next.inactive ?? inactiveDays;
    if (t) values.set("type", t);
    if (p !== "all") values.set("period", p);
    if (i !== 30) values.set("inactive", String(i));
    const query = values.toString();
    return query ? `/dashboard/clients?${query}` : "/dashboard/clients";
  };

  return (
    <AppShell profile={profile} active="/dashboard/clients" section="Monitorizare" title="Clienți"
      note={{ title: "Doar vizualizare", text: "Valoarea comandată este cea facturată în perioada aleasă (cu TVA)." }}>
      <section className="board-panel" aria-label="Clienți">
        <div className="panel-tabs-row">
          <h2 className="panel-tabs-title">Clienți</h2>
          <nav className="board-tabs panel-tabs" aria-label="Tip client">
            {types.map((item) => <Link key={item.value} href={href({ type: item.value })} className={type === item.value ? "active" : ""}
              aria-current={type === item.value ? "page" : undefined}>{item.label}<span>{counts[item.value]}</span><LinkPending /></Link>)}
          </nav>
          <span aria-hidden="true" />
        </div>
        <div className="receivables-heading">
          <div className="dashboard-presets" role="group" aria-label="Perioadă">
            {periods.map((item) => <Link key={item.value} href={href({ period: item.value })} className={period === item.value ? "preset active" : "preset"}>{item.label}<LinkPending /></Link>)}
          </div>
          <p className="clients-total">Total comandat: <strong>{formatMoney(total)} lei</strong></p>
        </div>
        {error ? <p className="notice error search-notice" role="alert">Clienții nu pot fi încărcați acum.</p>
          : rows.length === 0 ? <p className="admin-empty-note">Nu există clienți de acest tip.</p>
          : <div className="handed-table-wrap"><table className="handed-table team-table">
            <thead><tr><th>Client</th><th>Tip</th><th>Agent</th><th>Grup de livrare</th><th>Comenzi</th><th>Bucăți</th><th>Valoare comandată</th><th>De încasat</th><th>Ultima cerere</th></tr></thead>
            <tbody>{rows.map((client) => <tr key={client.id}>
              <td><span className="strong">{client.name}</span><small>{client.location}</small></td>
              <td><span className={`partner-kind ${client.type}`}>{typeLabel(client.type)}</span></td>
              <td>{client.agent ?? <span className="muted">Fără agent</span>}</td>
              <td>{client.delivery_groups.length ? client.delivery_groups.join(", ") : <span className="muted">Fără grup</span>}</td>
              <td>{number.format(client.orders)}</td>
              <td>{number.format(client.units)}</td>
              <td className="strong">{formatMoney(Number(client.invoiced_value))} lei</td>
              <td>{Number(client.outstanding) > 0 ? `${formatMoney(Number(client.outstanding))} lei` : "—"}</td>
              <td>{client.last_order ? formatDateTime(client.last_order) : <span className="muted">—</span>}</td>
            </tr>)}</tbody>
          </table></div>}
      </section>

      <section className="board-panel team-section inactive-section" aria-label="Clienți inactivi">
        <div className="receivables-heading">
          <h2>Clienți inactivi</h2>
          <div className="dashboard-presets" role="group" aria-label="Fără cereri de">
            {inactiveOptions.map((days) => <Link key={days} href={href({ inactive: days })} className={inactiveDays === days ? "preset active" : "preset"}>{days} zile<LinkPending /></Link>)}
          </div>
        </div>
        {inactive.length === 0 ? <p className="admin-empty-note">Toți clienții au avut cereri în ultimele {inactiveDays} zile.</p>
          : <div className="handed-table-wrap"><table className="handed-table team-table">
            <thead><tr><th>Client</th><th>Tip</th><th>Agent</th><th>Ultima cerere</th></tr></thead>
            <tbody>{inactive.map((client) => <tr key={client.id}>
              <td><span className="strong">{client.name}</span><small>{client.location}</small></td>
              <td><span className={`partner-kind ${client.type}`}>{typeLabel(client.type)}</span></td>
              <td>{client.agent ?? <span className="muted">Fără agent</span>}</td>
              <td>{client.last_order ? formatDateTime(client.last_order) : <span className="payment-chip soon">Nicio cerere</span>}</td>
            </tr>)}</tbody>
          </table></div>}
      </section>
    </AppShell>
  );
}
