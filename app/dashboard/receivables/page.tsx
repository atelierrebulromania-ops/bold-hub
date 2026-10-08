import { AppShell } from "@/components/app-shell";
import { PaymentChip } from "@/components/payment-chip";
import { requireRole } from "@/lib/auth";
import { formatDueDate } from "@/lib/invoice-status";
import { formatDateTime } from "@/lib/orders";
import { formatMoney } from "@/lib/pricing";
import { AgentFilter } from "./agent-filter";
import { RecheckButton } from "./recheck-button";

export const dynamic = "force-dynamic";

function bucharestToday() {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Bucharest" }).format(new Date());
}

// What the B2B clients still owe, grouped by client, with the overdue part first.
export default async function ReceivablesPage({ searchParams }: { searchParams: Promise<{ agent?: string }> }) {
  const { supabase, profile } = await requireRole(["owner"]);
  const agentFilter = (await searchParams).agent ?? "";
  const { data, error } = await supabase.rpc("b2b_receivables");
  const today = bucharestToday();
  const all = data ?? [];
  const agents = [...new Set(all.map((row) => row.agent_name ?? "Fără agent"))].sort((a, b) => a.localeCompare(b, "ro"));
  const rows = all.filter((row) => !agentFilter || (row.agent_name ?? "Fără agent") === agentFilter);
  const owed = (row: (typeof rows)[number]) => row.rest ?? row.total ?? 0;
  const overdue = rows.filter((row) => row.due_date && row.due_date < today);
  const totalOwed = rows.reduce((sum, row) => sum + owed(row), 0);
  const totalOverdue = overdue.reduce((sum, row) => sum + owed(row), 0);

  const byClient = new Map<string, typeof rows>();
  for (const row of rows) byClient.set(row.partner_name, [...(byClient.get(row.partner_name) ?? []), row]);
  const clients = [...byClient.entries()].map(([name, invoices]) => ({
    name, invoices, agent: invoices[0].agent_name ?? "Fără agent",
    owed: invoices.reduce((sum, row) => sum + owed(row), 0),
    overdue: invoices.filter((row) => row.due_date && row.due_date < today).reduce((sum, row) => sum + owed(row), 0),
  })).sort((a, b) => b.overdue - a.overdue || b.owed - a.owed);

  return (
    <AppShell profile={profile} active="/dashboard/receivables" section="Monitorizare" title="Facturi restante"
      note={{ title: "Facturi restante", text: "Facturile B2B neîncasate, din BOCP. Plățile se reverifică automat în fiecare dimineață." }}>
      {error && <p className="notice error admin-feedback" role="alert">Facturile nu pot fi încărcate acum.</p>}
      <div className="stat-grid receivables-summary">
        <div className="stat-card dashboard-stat"><div><p>De încasat</p><strong>{formatMoney(totalOwed)} lei</strong><small>{rows.length} {rows.length === 1 ? "factură" : "facturi"}</small></div></div>
        <div className="stat-card dashboard-stat overdue-stat"><div><p>Depășite</p><strong>{formatMoney(totalOverdue)} lei</strong><small>{overdue.length} {overdue.length === 1 ? "factură" : "facturi"}</small></div></div>
        <div className="stat-card dashboard-stat"><div><p>Clienți cu restanțe</p><strong>{clients.filter((client) => client.overdue > 0).length}</strong><small>din {clients.length} cu sold</small></div></div>
      </div>
      <section className="board-panel" aria-label="Facturi restante pe clienți">
        <div className="receivables-heading">
          <h2>Clienți</h2>
          <div className="receivables-controls">
            <AgentFilter agents={agents} current={agentFilter} />
            <RecheckButton />
          </div>
        </div>
        {clients.length === 0 ? <p className="admin-empty-note">Nu există facturi B2B neîncasate.</p>
          : <div className="handed-table-wrap"><table className="handed-table receivables-table">
            <thead><tr><th>Client / factură</th><th>Agent</th><th>Emisă</th><th>Scadență</th><th>Total</th><th>De încasat</th><th>Verificată</th></tr></thead>
            {clients.map((client) => <tbody key={client.name}>
              <tr className="receivables-client">
                <td className="strong">{client.name}</td><td>{client.agent}</td><td /><td>{client.overdue > 0 && <span className="payment-chip overdue">Depășit {formatMoney(client.overdue)} lei</span>}</td>
                <td /><td className="nowrap strong">{formatMoney(client.owed)} lei</td><td />
              </tr>
              {client.invoices.map((row) => <tr key={`${row.source}-${row.id}`}>
                <td className="receivables-invoice">{row.invoice_number}</td>
                <td />
                <td className="nowrap">{formatDueDate(row.invoice_date)}</td>
                <td className="nowrap">{row.due_date ? <PaymentChip dueDate={row.due_date} rest={row.rest} /> : "—"}</td>
                <td className="nowrap">{row.total !== null ? `${formatMoney(row.total)} lei` : "—"}</td>
                <td className="nowrap">{row.rest !== null ? `${formatMoney(row.rest)} lei` : "neverificat"}</td>
                <td className="nowrap muted">{row.payment_checked_at ? formatDateTime(row.payment_checked_at) : "—"}</td>
              </tr>)}
            </tbody>)}
          </table></div>}
      </section>
    </AppShell>
  );
}
