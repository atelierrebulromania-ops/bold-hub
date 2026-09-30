import Image from "next/image";
import { signOut } from "@/app/login/actions";
import { NavCountsListener } from "@/components/nav-counts-listener";
import { PaymentChip } from "@/components/payment-chip";
import { RoleSwitcher } from "@/components/role-switcher";
import { requirePartner } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { formatDateTime } from "@/lib/orders";
import { markNewsRead, removeOwnItem, submitCounts } from "./actions";
import { SubmitButton } from "@/components/submit-button";

export const dynamic = "force-dynamic";

const errors: Record<string, string> = {
  invalid: "Introdu doar numere întregi (bucăți rămase pe raft).",
  empty: "Completează cel puțin un produs.",
  stale: "Coșul s-a schimbat între timp. Verifică din nou.",
  save_failed: "Cererea nu a putut fi trimisă. Încearcă din nou.",
};

type Product = { name: string; variant_label: string | null } | null;
type Line = { id: string; quantity_needed: number; products: Product };
type Cart = { id: string; status: string; created_at: string; prepared_at: string | null; delivered_at: string | null; invoiced_at: string | null;
  invoice_number: string | null; partner_cart_items: Line[] };

const MONTHS = 6;

function productLabel(product: Product) {
  return product ? `${product.name}${product.variant_label ? ` · ${product.variant_label}` : ""}` : "Produs";
}

function monthKey(value: string) {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Bucharest", year: "numeric", month: "2-digit" }).format(new Date(value));
}

function monthLabel(key: string) {
  return new Intl.DateTimeFormat("ro-RO", { month: "short", year: "2-digit" }).format(new Date(`${key}-15T12:00:00`));
}

function formatDay(value: string) {
  return new Intl.DateTimeFormat("ro-RO", { day: "2-digit", month: "short", year: "numeric" }).format(new Date(`${value.slice(0, 10)}T12:00:00`));
}

// Where an order is: request received → prepared in the warehouse → delivered → invoiced.
function steps(cart: Cart) {
  return [
    { label: "Cerere primită", at: cart.created_at, done: true },
    { label: "Pregătită în depozit", at: cart.prepared_at, done: cart.status !== "open" },
    { label: "Livrată", at: cart.delivered_at, done: cart.status === "delivered" },
    { label: "Facturată", at: cart.invoiced_at, done: !!cart.invoiced_at },
  ];
}

export default async function PartnerPage({ searchParams }: { searchParams: Promise<{ notice?: string; error?: string; units?: string }> }) {
  const { supabase, partner, preview } = await requirePartner();
  const params = await searchParams;
  const since = new Date();
  since.setMonth(since.getMonth() - (MONTHS - 1), 1);
  const cartFields = "id,status,created_at,prepared_at,delivered_at,invoiced_at,invoice_number,partner_cart_items(id,quantity_needed,products(name,variant_label))";
  const [parsResult, activeResult, deliveredResult, invoicesResult, newsResult] = await Promise.all([
    supabase.from("partner_par_levels").select("product_id,par_level_quantity,products(name,sku,variant_label,active)")
      .eq("partner_id", partner.id).limit(500),
    // In progress: requested, on the shelf, or delivered and still waiting for the invoice.
    supabase.from("partner_carts").select(cartFields).eq("partner_id", partner.id)
      .or("status.in.(open,prepared),and(status.eq.delivered,invoiced_at.is.null)").order("created_at"),
    supabase.from("partner_carts").select(cartFields).eq("partner_id", partner.id).eq("status", "delivered")
      .gte("delivered_at", since.toISOString()).order("delivered_at", { ascending: false }).limit(200),
    supabase.rpc("partner_invoices", { p_partner_id: partner.id }),
    preview ? Promise.resolve(null)
      : supabase.from("notifications").select("id,message,created_at").eq("recipient_partner_id", partner.id).is("read_at", null)
        .order("created_at", { ascending: false }).limit(5),
  ]);
  const loadError = parsResult.error ?? activeResult.error ?? deliveredResult.error;
  const pars = (parsResult.data ?? []).filter(par => par.products?.active)
    .sort((a, b) => productLabel(a.products).localeCompare(productLabel(b.products), "ro"));
  const active = (activeResult.data ?? []) as Cart[];
  const delivered = (deliveredResult.data ?? []) as Cart[];
  const invoices = invoicesResult.data ?? [];
  const news = newsResult?.data ?? [];
  const inProgress = new Map<string, number>();
  for (const cart of active) if (cart.status !== "delivered") for (const line of cart.partner_cart_items) {
    const key = productLabel(line.products);
    inProgress.set(key, (inProgress.get(key) ?? 0) + line.quantity_needed);
  }

  // Consumption: what was delivered per product, per month (last months).
  const months = Array.from({ length: MONTHS }, (_, index) => {
    const date = new Date(since);
    date.setMonth(since.getMonth() + index);
    return monthKey(date.toISOString());
  });
  const usage = new Map<string, Map<string, number>>();
  for (const cart of delivered) {
    if (!cart.delivered_at) continue;
    const month = monthKey(cart.delivered_at);
    for (const line of cart.partner_cart_items) {
      const product = productLabel(line.products);
      const row = usage.get(product) ?? new Map<string, number>();
      row.set(month, (row.get(month) ?? 0) + line.quantity_needed);
      usage.set(product, row);
    }
  }
  const usageRows = [...usage.entries()].map(([product, byMonth]) => ({ product, byMonth, total: [...byMonth.values()].reduce((a, b) => a + b, 0) }))
    .sort((a, b) => b.total - a.total);
  const maxCell = Math.max(1, ...usageRows.flatMap(row => [...row.byMonth.values()]));

  return (
    <main className="partner-app">
      <NavCountsListener tables={["partner_carts", "notifications"]} />
      <header className="partner-header">
        <div className="brand"><Image src="/icon.png" alt="" width={300} height={300} className="brand-icon-image" /><div><strong>{partner.business_name}</strong></div></div>
        {preview && <PreviewSwitcher partnerId={partner.id} />}
        <form action={signOut}><SubmitButton className="text-button">Ieșire</SubmitButton></form>
      </header>
      <div className="partner-content">
        {params.notice === "added" && <p className="preview-alert success" role="status">Am adăugat {params.units} buc. în comandă. Depozitul pregătește produsele.</p>}
        {params.notice === "nothing" && <p className="preview-alert warning" role="status">Nu e nevoie de refill: ai stocul inițial complet (inclusiv ce e deja comandat).</p>}
        {params.notice === "removed" && <p className="preview-alert success" role="status">Produsul a fost scos din comandă.</p>}
        {params.error && errors[params.error] && <p className="notice error" role="alert">{errors[params.error]}</p>}

        {news.length > 0 && <section className="partner-news" aria-label="Noutăți">
          <ul>{news.map(item => <li key={item.id}><span>{item.message}</span><small>{formatDateTime(item.created_at)}</small></li>)}</ul>
          <form action={markNewsRead}><SubmitButton className="text-button">Am văzut</SubmitButton></form>
        </section>}

        {loadError ? <p className="notice error" role="alert">Datele nu pot fi încărcate acum.</p> : <>
          <section className="admin-card">
            <div className="admin-card-heading"><h2>Cerere aprovizionare</h2><p>Scrie câte bucăți mai ai pe raft. Calculăm automat cât lipsește până la stocul tău inițial.</p></div>
            {pars.length === 0 ? <p className="admin-empty-note">Stocul inițial nu a fost configurat încă. Contactează Atelier Rebul.</p>
              : <form action={submitCounts} className="refill-count-form">
                <div className="refill-count-head" aria-hidden="true"><span>Produs</span><span className="refill-count-inputs"><span>Rămase</span><span>Stoc inițial</span></span></div>
                {pars.map(par => <label key={par.product_id} className="refill-count-row">
                  <span><strong>{productLabel(par.products)}</strong>{inProgress.get(productLabel(par.products)) ? <small>{inProgress.get(productLabel(par.products))} buc. deja comandate</small> : null}</span>
                  <span className="refill-count-inputs">
                    <input name={`remaining_${par.product_id}`} type="number" inputMode="numeric" min={0} max={999999} placeholder="Rămase" aria-label={`Bucăți rămase: ${productLabel(par.products)}`}/>
                    <span className="initial-stock" aria-label={`Stoc inițial ${par.par_level_quantity}`}><strong>{par.par_level_quantity}</strong></span>
                  </span>
                </label>)}
                <SubmitButton className="button button-primary">Trimite cererea</SubmitButton>
              </form>}
          </section>

          <section className="admin-card partner-list-section">
            <div className="admin-card-heading"><h2>Comenzi în curs</h2></div>
            {active.length === 0 ? <p className="admin-empty-note">Nu ai comenzi în curs.</p> : <div className="partner-list">
              {active.map(cart => <article key={cart.id} className="partner-card">
                <ol className="order-steps">{steps(cart).map(step => <li key={step.label} className={step.done ? "done" : ""}>
                  <strong>{step.label}</strong><small>{step.done && step.at ? formatDateTime(step.at) : "—"}</small></li>)}</ol>
                <ul className="par-list partner-lines">{cart.partner_cart_items.map(line => <li key={line.id}>
                  <span>{productLabel(line.products)}</span>
                  <span className="line-end"><strong>{line.quantity_needed} buc.</strong>
                    {cart.status === "open" && <form action={removeOwnItem}><input type="hidden" name="item_id" value={line.id}/><SubmitButton className="text-button">Scoate</SubmitButton></form>}</span>
                </li>)}</ul>
              </article>)}
            </div>}
          </section>

          <section className="admin-card partner-list-section">
            <div className="admin-card-heading"><h2>Facturi</h2></div>
            {invoices.length === 0 ? <p className="admin-empty-note">Nu ai încă facturi.</p>
              : <ul className="par-list partner-lines">{invoices.map(invoice => <li key={`${invoice.source}-${invoice.id}`}>
                <span className="invoice-line"><span><strong>{invoice.invoice_number}</strong> · {formatDay(invoice.invoice_date)}</span>
                  <PaymentChip dueDate={invoice.due_date} rest={invoice.rest} audience="partner" /></span>
                <a className="text-button" href={`/partner/invoice/${invoice.source}/${invoice.id}`} target="_blank" rel="noopener noreferrer">Descarcă</a>
              </li>)}</ul>}
          </section>

          <section className="admin-card partner-list-section">
            <div className="admin-card-heading"><h2>Consumul tău</h2><p>Bucăți livrate pe lună, în ultimele {MONTHS} luni.</p></div>
            {usageRows.length === 0 ? <p className="admin-empty-note">Încă nu există livrări în această perioadă.</p>
              : <div className="handed-table-wrap"><table className="handed-table usage-table">
                <thead><tr><th>Produs</th>{months.map(month => <th key={month}>{monthLabel(month)}</th>)}<th>Total</th></tr></thead>
                <tbody>{usageRows.map(row => <tr key={row.product}>
                  <td className="strong">{row.product}</td>
                  {months.map(month => {
                    const value = row.byMonth.get(month) ?? 0;
                    return <td key={month} className="usage-cell">{value > 0 && <span className="usage-bar" style={{ width: `${Math.max(12, (value / maxCell) * 100)}%` }} />}<span>{value || "—"}</span></td>;
                  })}
                  <td className="nowrap strong">{row.total}</td>
                </tr>)}</tbody>
              </table></div>}
          </section>

        </>}
      </div>
    </main>
  );
}

// Dev mode: the admin previewing this location can switch back from here.
async function PreviewSwitcher({ partnerId }: { partnerId: string }) {
  const supabase = await createClient();
  const { data } = await supabase.from("partners").select("id,business_name").eq("active", true).order("business_name").limit(200);
  return <RoleSwitcher current={`partner:${partnerId}`} partners={data ?? []} />;
}
