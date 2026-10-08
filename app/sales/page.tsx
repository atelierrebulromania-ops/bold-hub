import { AppShell } from "@/components/app-shell";
import { ActionCard, Stat, todayLabel, waitingFor } from "@/components/dashboard-cards";
import { PaymentChip } from "@/components/payment-chip";
import { requireRole } from "@/lib/auth";
import { bucharestDay, bucharestMidnight } from "@/lib/dashboard-range";
import { formatMoney } from "@/lib/pricing";

export const dynamic = "force-dynamic";

const INACTIVE_DAYS = 30;
const DUE_SOON_DAYS = 14;
const number = new Intl.NumberFormat("ro-RO");

function dateLabel(value: string) {
  return new Intl.DateTimeFormat("ro-RO", { day: "2-digit", month: "short", year: "numeric", timeZone: "Europe/Bucharest" }).format(new Date(value));
}

export default async function SalesDashboard() {
  const { supabase, profile } = await requireRole(["account"]);
  const now = Date.now();
  const today = bucharestDay(new Date(now));
  const monthStart = bucharestMidnight(`${today.slice(0, 7)}-01`).toISOString();

  // Row security limits partners, carts and documents to this agent's own clients.
  const [requests, offers, derived, proformas, invoices, partners, carts] = await Promise.all([
    supabase.from("partner_carts").select("id,created_at").eq("status", "open").order("created_at").limit(200),
    supabase.from("sales_documents").select("id,issued_at,validity_days")
      .eq("kind", "offer").eq("status", "issued").eq("account_id", profile.id).limit(500),
    supabase.from("sales_documents").select("source_document_id").eq("account_id", profile.id).not("source_document_id", "is", null)
      .in("status", ["issuing", "issued", "cancel_requested"]).limit(1000),
    supabase.from("sales_documents").select("id,issued_at").eq("kind", "proforma").eq("status", "issued").eq("account_id", profile.id)
      .is("invoice_requested_at", null).is("cart_id", null).order("issued_at").limit(200),
    supabase.rpc("account_invoices"),
    supabase.from("partners").select("id,business_name,location_name,created_at").eq("active", true).eq("account_id", profile.id).limit(500),
    supabase.from("partner_carts").select("partner_id,created_at").order("created_at", { ascending: false }).limit(5000),
  ]);
  const loadError = requests.error ?? offers.error ?? derived.error ?? proformas.error ?? partners.error ?? carts.error;

  // Offers still open: issued, not turned into a proforma, and still valid.
  const converted = new Set((derived.data ?? []).map(doc => doc.source_document_id));
  const openOffers = (offers.data ?? []).filter(offer => !converted.has(offer.id) && offer.issued_at && new Date(offer.issued_at).getTime() + offer.validity_days * 86400000 > now);
  const expiringSoon = openOffers.filter(offer => new Date(offer.issued_at!).getTime() + offer.validity_days * 86400000 - now < 3 * 86400000).length;

  const allInvoices = invoices.data ?? [];
  const unpaid = allInvoices.filter(invoice => invoice.rest === null || invoice.rest > 0);
  const overdue = unpaid.filter(invoice => invoice.due_date && invoice.due_date < today && (invoice.rest ?? 0) > 0);
  const overdueAmount = overdue.reduce((sum, invoice) => sum + (invoice.rest ?? 0), 0);
  const dueLimit = new Date(now + DUE_SOON_DAYS * 86400000).toISOString().slice(0, 10);
  const dueList = unpaid.filter(invoice => invoice.due_date && invoice.due_date <= dueLimit && (invoice.rest ?? 1) > 0)
    .sort((a, b) => (a.due_date ?? "").localeCompare(b.due_date ?? ""));

  const thisMonth = allInvoices.filter(invoice => invoice.invoiced_at && invoice.invoiced_at >= monthStart);
  const invoicedValue = thisMonth.reduce((sum, invoice) => sum + (invoice.total ?? 0), 0);
  const offersThisMonth = (offers.data ?? []).filter(offer => offer.issued_at && offer.issued_at >= monthStart).length;
  const newClients = (partners.data ?? []).filter(partner => partner.created_at >= monthStart).length;

  // Clients with no request in the last weeks (or never).
  const lastOrder = new Map<string, string>();
  for (const cart of carts.data ?? []) if (!lastOrder.has(cart.partner_id)) lastOrder.set(cart.partner_id, cart.created_at);
  const inactiveSince = now - INACTIVE_DAYS * 86400000;
  const inactive = (partners.data ?? []).map(partner => ({ ...partner, last: lastOrder.get(partner.id) ?? null }))
    .filter(partner => !partner.last || new Date(partner.last).getTime() < inactiveSince)
    .sort((a, b) => (a.last ?? "").localeCompare(b.last ?? ""));
  const oldestRequest = requests.data?.[0]?.created_at;
  const firstName = profile.full_name?.split(" ")[0];

  return (
    <AppShell profile={profile} active="/sales" section="Vânzări" title="Dashboard"
      note={{ title: "Pe scurt", text: "Ce așteaptă de la tine clienții și cum merge luna." }}>
      <div className="page-heading"><div><p className="eyebrow">VÂNZĂRI</p><h1>{firstName ? `Salut, ${firstName}` : "Dashboard"}</h1><p className="muted today-label">{todayLabel()}</p></div></div>

      {loadError ? <p className="notice error" role="alert">Datele nu pot fi încărcate acum.</p> : <>
        <h2 className="dashboard-section-title">De făcut acum</h2>
        <div className="stat-grid">
          <ActionCard href="/partners" label="Cereri de la clienți" value={requests.data?.length ?? 0}
            hint={oldestRequest ? `cea mai veche ${waitingFor(oldestRequest, now)}` : "nicio cerere deschisă"} />
          <ActionCard href="/account/offers" label="Oferte în așteptare" value={openOffers.length}
            hint={expiringSoon ? `${expiringSoon} expiră în 3 zile` : openOffers.length ? "trimise, fără proformă" : "nicio ofertă deschisă"} />
          <ActionCard href="/account/offers?tab=proforme" label="Proforme fără pas următor" value={proformas.data?.length ?? 0}
            hint={proformas.data?.length ? "rezervă comanda sau cere factura" : "toate sunt în lucru"} />
          <ActionCard href="/account/offers?tab=facturi" label="Facturi depășite" value={overdue.length} alert={overdue.length > 0}
            hint={overdue.length ? `${formatMoney(overdueAmount)} lei de încasat` : "nicio factură depășită"} />
        </div>

        <h2 className="dashboard-section-title">Luna aceasta</h2>
        <div className="stat-grid">
          <Stat label="Facturat" value={`${formatMoney(invoicedValue)} lei`} hint="cu TVA, clienții tăi" />
          <Stat label="Facturi" value={number.format(thisMonth.length)} hint="emise de facturare" />
          <Stat label="Oferte emise" value={number.format(offersThisMonth)} hint={`${number.format(openOffers.length)} încă deschise`} />
          <Stat label="Clienți noi" value={number.format(newClients)} hint={`din ${number.format(partners.data?.length ?? 0)} activi`} />
        </div>

        <div className="dashboard-grid">
          <section className="admin-card">
            <div className="admin-card-heading"><h2>Scadențe</h2><p>Facturi neplătite, depășite sau cu scadența în următoarele {DUE_SOON_DAYS} zile.</p></div>
            {dueList.length === 0 ? <p className="admin-empty-note">Nicio scadență apropiată.</p>
              : <ul className="admin-simple-list dashboard-list">{dueList.slice(0, 12).map(invoice => <li key={`${invoice.source}-${invoice.id}`}>
                <span>{invoice.partner_name}<small>{invoice.invoice_number}{invoice.rest ? ` · ${formatMoney(invoice.rest)} lei` : ""}</small></span>
                <PaymentChip dueDate={invoice.due_date} rest={invoice.rest} />
              </li>)}</ul>}
          </section>
          <section className="admin-card">
            <div className="admin-card-heading"><h2>Clienți inactivi</h2><p>Fără cerere în ultimele {INACTIVE_DAYS} de zile.</p></div>
            {inactive.length === 0 ? <p className="admin-empty-note">Toți clienții au comandat recent.</p>
              : <ul className="admin-simple-list dashboard-list">{inactive.slice(0, 12).map(partner => <li key={partner.id}>
                <span>{partner.business_name}<small>{partner.location_name}</small></span>
                <small className="muted">{partner.last ? `ultima ${dateLabel(partner.last)}` : "nicio comandă"}</small>
              </li>)}</ul>}
          </section>
        </div>
      </>}
    </AppShell>
  );
}
