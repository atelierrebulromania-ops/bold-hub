import { AppShell } from "@/components/app-shell";
import { requireRole } from "@/lib/auth";
import { formatDateTime } from "@/lib/orders";
import { markInvoiced } from "./actions";

export const dynamic = "force-dynamic";

const notices: Record<string, string> = {
  invoiced: "Factura a fost înregistrată. Livrarea poate pleca spre revânzători.",
};

const errors: Record<string, string> = {
  invalid: "Introdu numărul facturii emise în BOCP (maximum 60 caractere).",
  already_done: "Livrarea a fost deja facturată sau nu mai așteaptă factura.",
  save_failed: "Nu am putut salva. Reîncarcă pagina și încearcă din nou.",
};

const triggerLabels: Record<string, string> = {
  manual: "Declanșare manuală",
  important_client: "Client important",
  countdown_48h: "Countdown 48h",
};

const fields = "id,status,created_at,ready_confirmed_at,invoice_number,invoiced_at,deliveries(trigger_type,delivery_groups(name),delivery_carts(reseller_carts(resellers(business_name,location_name),reseller_cart_items(quantity_needed,products(name,sku,variant_label)))))" as const;

export default async function BillingPage({
  searchParams,
}: {
  searchParams: Promise<{ notice?: string; error?: string }>;
}) {
  const { supabase, profile } = await requireRole(["admin", "operator_facturare"]);
  const params = await searchParams;
  const recentStart = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const [waitingResult, invoicedResult] = await Promise.all([
    supabase.from("reseller_order_fulfillments").select(fields).eq("status", "ready_to_deliver")
      .order("ready_confirmed_at", { ascending: true }).limit(200),
    supabase.from("reseller_order_fulfillments").select(fields).in("status", ["invoiced", "delivered"])
      .gte("invoiced_at", recentStart).order("invoiced_at", { ascending: false }).limit(50),
  ]);
  const loadError = waitingResult.error ?? invoicedResult.error;
  const waiting = waitingResult.data ?? [];
  const invoiced = invoicedResult.data ?? [];

  return (
    <AppShell profile={profile} active="/billing" section="Operațiuni" title="Facturare refill"
      note={{ title: "Fluxul invers", text: "Factura se emite abia după ce depozitul confirmă pregătirea." }}>
      <div className="page-heading"><div><p className="eyebrow">FACTURARE</p><h1>Facturare refill</h1><p className="muted">Livrările către revânzători confirmate ca pregătite de depozit. Emite factura în BOCP, apoi înregistreaz-o aici.</p></div><span className="page-heading-chip preview-chip">{waiting.length} de facturat</span></div>
      {params.notice && notices[params.notice] && <p className="preview-alert success admin-feedback" role="status">{notices[params.notice]}</p>}
      {params.error && errors[params.error] && <p className="notice error admin-feedback" role="alert">{errors[params.error]}</p>}
      {loadError ? <p className="notice error" role="alert">Livrările nu pot fi încărcate acum.</p> : <>
        <section className="admin-card" aria-labelledby="waiting-title">
          <div className="admin-card-heading"><h2 id="waiting-title">Așteaptă factura</h2><p>Produsele sunt deja pregătite fizic în depozit.</p></div>
          {waiting.length === 0 ? <p className="admin-empty-note">Nicio livrare nu așteaptă factura. Livrările apar aici după confirmarea „ready to deliver” din depozit.</p> : <div className="reseller-list">
            {waiting.map(item => <FulfillmentCard key={item.id} item={item}>
              <form action={markInvoiced} className="admin-inline admin-mini-form">
                <input type="hidden" name="fulfillment_id" value={item.id}/>
                <input name="invoice_number" maxLength={60} required placeholder="Nr. factură BOCP" aria-label="Număr factură"/>
                <button className="button button-primary" type="submit">Înregistrează factura</button>
              </form>
            </FulfillmentCard>)}
          </div>}
        </section>
        <section className="admin-card reseller-list-section" aria-labelledby="invoiced-title">
          <div className="admin-card-heading"><h2 id="invoiced-title">Facturate în ultimele 30 de zile</h2></div>
          {invoiced.length === 0 ? <p className="admin-empty-note">Nicio factură de refill înregistrată recent.</p> : <div className="reseller-list">
            {invoiced.map(item => <FulfillmentCard key={item.id} item={item}/>)}
          </div>}
        </section>
      </>}
    </AppShell>
  );
}

type Fulfillment = {
  id: string;
  status: string;
  created_at: string;
  ready_confirmed_at: string | null;
  invoice_number: string | null;
  invoiced_at: string | null;
  deliveries: {
    trigger_type: string;
    delivery_groups: { name: string } | null;
    delivery_carts: { reseller_carts: {
      resellers: { business_name: string; location_name: string } | null;
      reseller_cart_items: { quantity_needed: number; products: { name: string; sku: string; variant_label: string | null } | null }[];
    } | null }[];
  } | null;
};

function FulfillmentCard({ item, children }: { item: Fulfillment; children?: React.ReactNode }) {
  const carts = (item.deliveries?.delivery_carts ?? []).map(link => link.reseller_carts).filter(cart => cart !== null);
  return (
    <article className="reseller-card">
      <div className="reseller-card-heading">
        <div>
          <h3>{item.deliveries?.delivery_groups?.name ?? "Livrare fără grup"}</h3>
          <p>{triggerLabels[item.deliveries?.trigger_type ?? ""] ?? "Livrare"} · {carts.length} {carts.length === 1 ? "locație" : "locații"}</p>
          <small>Pregătită {formatDateTime(item.ready_confirmed_at ?? item.created_at)}{item.invoice_number ? ` · factura ${item.invoice_number} din ${formatDateTime(item.invoiced_at)}` : ""}</small>
        </div>
      </div>
      <div className="reseller-card-grid">
        {carts.map((cart, index) => <div key={index}>
          <h4>{cart.resellers?.business_name ?? "Revânzător"}<small className="fulfillment-location"> · {cart.resellers?.location_name}</small></h4>
          <ul className="par-list">{cart.reseller_cart_items.map((line, lineIndex) => <li key={lineIndex}>
            <span>{line.products?.name ?? "Produs"}{line.products?.variant_label ? ` · ${line.products.variant_label}` : ""}<small>SKU {line.products?.sku ?? "—"}</small></span>
            <strong>{line.quantity_needed} buc.</strong>
          </li>)}</ul>
        </div>)}
      </div>
      {children}
    </article>
  );
}
