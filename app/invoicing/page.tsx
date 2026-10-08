import { AppShell } from "@/components/app-shell";
import { ActionCard, Stat, WeekChart, todayLabel, waitingFor } from "@/components/dashboard-cards";
import { requireRole } from "@/lib/auth";
import { addDays, bucharestDay, bucharestMidnight } from "@/lib/dashboard-range";
import { formatMoney } from "@/lib/pricing";

export const dynamic = "force-dynamic";

const DAYS = 7;
const LATE_HOURS = 24;
const number = new Intl.NumberFormat("ro-RO");

type Invoiced = { invoiced_at: string | null; invoiced_by: string | null; invoice_total: number | null };
type Waiting = { key: string; client: string; detail: string; since: string; kind: "B2B" | "Proformă" };

export default async function InvoicingDashboard() {
  const { supabase, profile } = await requireRole(["operator_facturare"]);
  const now = Date.now();
  const today = bucharestDay(new Date(now));
  const todayStart = bucharestMidnight(today).toISOString();
  const days = Array.from({ length: DAYS }, (_, index) => addDays(today, index - (DAYS - 1)));
  const weekStart = bucharestMidnight(days[0]).toISOString();
  const count = { count: "exact", head: true } as const;

  const [carts, failed, proformas, cancels, invoicedCarts, invoicedDocs, returnsToday, myReturnsToday, cancelledToday] = await Promise.all([
    supabase.from("partner_carts").select("id,delivered_at,partners(business_name,location_name),partner_cart_items(quantity_needed)")
      .eq("status", "delivered").is("invoiced_at", null).order("delivered_at").limit(100),
    supabase.from("partner_carts").select("id", count).in("status", ["prepared", "delivered"]).not("prepared_at", "is", null).is("reserved_in_bocp_at", null),
    supabase.from("sales_documents").select("id,client_name,bocp_proforma_number:number,invoice_requested_at,bocp_proforma_total")
      .eq("status", "issued").not("invoice_requested_at", "is", null).is("invoiced_at", null).order("invoice_requested_at").limit(100),
    supabase.from("sales_documents").select("id,cancel_requested_at").eq("status", "cancel_requested").order("cancel_requested_at").limit(100),
    supabase.from("partner_carts").select("invoiced_at,invoiced_by,invoice_total").gte("invoiced_at", weekStart).limit(2000),
    supabase.from("sales_documents").select("invoiced_at,invoiced_by,invoice_total").gte("invoiced_at", weekStart).limit(2000),
    supabase.from("order_returns").select("id", count).gte("registered_at", todayStart),
    supabase.from("order_returns").select("id", count).gte("registered_at", todayStart).eq("registered_by", profile.id),
    supabase.from("sales_documents").select("id", count).gte("cancelled_at", todayStart),
  ]);
  const loadError = carts.error ?? failed.error ?? proformas.error ?? cancels.error ?? invoicedCarts.error ?? invoicedDocs.error;

  const waiting: Waiting[] = [
    ...(carts.data ?? []).map(cart => ({
      key: `cart-${cart.id}`, kind: "B2B" as const, client: cart.partners?.business_name ?? "Client", since: cart.delivered_at ?? "",
      detail: `${cart.partners?.location_name ?? ""} · ${number.format(cart.partner_cart_items.reduce((sum, line) => sum + line.quantity_needed, 0))} buc.`,
    })),
    ...(proformas.data ?? []).map(document => ({
      key: `doc-${document.id}`, kind: "Proformă" as const, client: document.client_name, since: document.invoice_requested_at ?? "",
      detail: `${document.bocp_proforma_number ?? "Proformă"}${document.bocp_proforma_total ? ` · ${formatMoney(document.bocp_proforma_total)} lei` : ""}`,
    })),
  ].sort((a, b) => a.since.localeCompare(b.since));
  const late = waiting.filter(item => item.since && now - new Date(item.since).getTime() > LATE_HOURS * 3600000).length;
  const oldestCart = carts.data?.[0]?.delivered_at;
  const oldestProforma = proformas.data?.[0]?.invoice_requested_at;
  const oldestCancel = cancels.data?.[0]?.cancel_requested_at;

  // Invoices issued per day (team and mine), and today's totals.
  const perDay = new Map(days.map(day => [day, { team: 0, mine: 0 }]));
  let valueToday = 0;
  for (const invoice of [...(invoicedCarts.data ?? []), ...(invoicedDocs.data ?? [])] as Invoiced[]) {
    if (!invoice.invoiced_at) continue;
    const slot = perDay.get(bucharestDay(new Date(invoice.invoiced_at)));
    if (!slot) continue;
    slot.team += 1;
    if (invoice.invoiced_by === profile.id) slot.mine += 1;
    if (invoice.invoiced_at >= todayStart) valueToday += invoice.invoice_total ?? 0;
  }
  const invoicedToday = perDay.get(today) ?? { team: 0, mine: 0 };
  const firstName = profile.full_name?.split(" ")[0];

  return (
    <AppShell profile={profile} active="/invoicing" section="Facturare" title="Dashboard"
      note={{ title: "Pe scurt", text: "Ce e de facturat acum și cum a mers ziua." }}>
      <div className="page-heading"><div><p className="eyebrow">FACTURARE</p><h1>{firstName ? `Salut, ${firstName}` : "Dashboard"}</h1><p className="muted today-label">{todayLabel()}</p></div></div>

      {loadError ? <p className="notice error" role="alert">Datele nu pot fi încărcate acum.</p> : <>
        <h2 className="dashboard-section-title">De făcut acum</h2>
        <div className="stat-grid">
          <ActionCard href="/billing" label="Comenzi B2B de facturat" value={carts.data?.length ?? 0}
            hint={oldestCart ? `cea mai veche așteaptă ${waitingFor(oldestCart, now)}` : "nimic de facturat"} />
          <ActionCard href="/billing" label="Proforme de facturat" value={proformas.data?.length ?? 0}
            hint={oldestProforma ? `cea mai veche cerută ${waitingFor(oldestProforma, now)}` : "nicio cerere"} />
          <ActionCard href="/billing" label="Proforme de anulat" value={cancels.data?.length ?? 0} alert={(cancels.data?.length ?? 0) > 0}
            hint={oldestCancel ? `cerută ${waitingFor(oldestCancel, now)}` : "nicio cerere"} />
          <ActionCard href="/billing" label="Rezervări BOCP eșuate" value={failed.count ?? 0} alert={(failed.count ?? 0) > 0}
            hint={failed.count ? "de reîncercat după completarea datelor" : "toate rezervate"} />
        </div>

        <h2 className="dashboard-section-title">Azi</h2>
        <div className="stat-grid">
          <Stat label="Facturi emise" value={number.format(invoicedToday.team)} hint={`${number.format(invoicedToday.mine)} de tine`} />
          <Stat label="Valoare facturată" value={`${formatMoney(valueToday)} lei`} hint="cu TVA, B2B și proforme" />
          <Stat label="Retururi înregistrate" value={number.format(returnsToday.count ?? 0)} hint={`${number.format(myReturnsToday.count ?? 0)} de tine`} />
          <Stat label="Proforme anulate" value={number.format(cancelledToday.count ?? 0)} hint="confirmate azi" />
        </div>

        <div className="dashboard-grid">
          <section className="admin-card">
            <div className="admin-card-heading"><h2>Facturi emise în ultimele {DAYS} zile</h2><p>Toată echipa; partea închisă e a ta.</p></div>
            <WeekChart days={days.map(day => ({ day, ...perDay.get(day)! }))} label="facturi" />
          </section>
          <section className="admin-card">
            <div className="admin-card-heading"><h2>În așteptare</h2><p>{waiting.length ? `${waiting.length} de facturat${late ? `, ${late} de peste ${LATE_HOURS}h` : ""}.` : "Totul e facturat."}</p></div>
            {waiting.length === 0 ? <p className="admin-empty-note">Nu e nimic de facturat acum.</p>
              : <ul className="admin-simple-list dashboard-list">{waiting.slice(0, 12).map(item => {
                const isLate = item.since && now - new Date(item.since).getTime() > LATE_HOURS * 3600000;
                return <li key={item.key}>
                  <span>{item.client}<small>{item.kind} · {item.detail}</small></span>
                  <span className={`payment-chip ${isLate ? "overdue" : "open"}`}>{waitingFor(item.since, now) ?? "—"}</span>
                </li>;
              })}</ul>}
          </section>
        </div>
      </>}
    </AppShell>
  );
}
