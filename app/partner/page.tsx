import { signOut } from "@/app/login/actions";
import { requirePartner } from "@/lib/auth";
import { formatDateTime } from "@/lib/orders";
import { removeOwnItem, submitCounts } from "./actions";

export const dynamic = "force-dynamic";

const errors: Record<string, string> = {
  invalid: "Introdu doar numere întregi (bucăți rămase pe raft).",
  empty: "Completează cel puțin un produs.",
  stale: "Coșul s-a schimbat între timp. Verifică din nou.",
  save_failed: "Cererea nu a putut fi trimisă. Încearcă din nou.",
};

type Line = { id: string; quantity_needed: number; products: { name: string; variant_label: string | null } | null };

function productLabel(product: { name: string; variant_label: string | null } | null) {
  return product ? `${product.name}${product.variant_label ? ` · ${product.variant_label}` : ""}` : "Produs";
}

export default async function PartnerPage({ searchParams }: { searchParams: Promise<{ notice?: string; error?: string; units?: string }> }) {
  const { supabase, partner } = await requirePartner();
  const params = await searchParams;
  const [parsResult, cartsResult, historyResult] = await Promise.all([
    supabase.from("partner_par_levels").select("product_id,par_level_quantity,products(name,sku,variant_label,active)")
      .eq("partner_id", partner.id).limit(500),
    supabase.from("partner_carts").select("id,status,countdown_started_at,partner_cart_items(id,quantity_needed,products(name,variant_label))")
      .eq("partner_id", partner.id).in("status", ["open", "pending_delivery"]).order("created_at"),
    supabase.from("partner_carts").select("id,delivered_at,partner_cart_items(id,quantity_needed,products(name,variant_label))")
      .eq("partner_id", partner.id).eq("status", "delivered").order("delivered_at", { ascending: false }).limit(10),
  ]);
  const loadError = parsResult.error ?? cartsResult.error ?? historyResult.error;
  const pars = (parsResult.data ?? []).filter(par => par.products?.active)
    .sort((a, b) => productLabel(a.products).localeCompare(productLabel(b.products), "ro"));
  const openCart = (cartsResult.data ?? []).find(cart => cart.status === "open");
  const onTheWay = (cartsResult.data ?? []).filter(cart => cart.status === "pending_delivery");
  const history = historyResult.data ?? [];
  const inProgress = new Map<string, number>();
  for (const cart of cartsResult.data ?? []) for (const line of cart.partner_cart_items as Line[]) {
    const key = productLabel(line.products);
    inProgress.set(key, (inProgress.get(key) ?? 0) + line.quantity_needed);
  }

  return (
    <main className="partner-app">
      <header className="partner-header">
        <div className="brand"><div className="brand-icon">B<span>·</span></div><div><strong>{partner.business_name}</strong><small>{partner.location_name.toUpperCase()}</small></div></div>
        <form action={signOut}><button type="submit" className="text-button">Ieșire</button></form>
      </header>
      <div className="partner-content">
        {params.notice === "added" && <p className="preview-alert success" role="status">Am adăugat {params.units} buc. în coș. Depozitul pregătește produsele.</p>}
        {params.notice === "nothing" && <p className="preview-alert warning" role="status">Nu e nevoie de refill: ai stocul inițial complet (inclusiv ce e deja în coș sau pe drum).</p>}
        {params.notice === "removed" && <p className="preview-alert success" role="status">Produsul a fost scos din coș.</p>}
        {params.error && errors[params.error] && <p className="notice error" role="alert">{errors[params.error]}</p>}
        {loadError ? <p className="notice error" role="alert">Datele nu pot fi încărcate acum.</p> : <>
          <section className="admin-card">
            <div className="admin-card-heading"><h2>Cere refill</h2><p>Scrie câte bucăți mai ai pe raft. Calculăm automat cât lipsește până la stocul tău inițial.</p></div>
            {pars.length === 0 ? <p className="admin-empty-note">Stocul inițial nu a fost configurat încă. Contactează Atelier Rebul.</p>
              : <form action={submitCounts} className="refill-count-form">
                {pars.map(par => <label key={par.product_id} className="refill-count-row">
                  <span><strong>{productLabel(par.products)}</strong><small>Stoc inițial {par.par_level_quantity} buc.{inProgress.get(productLabel(par.products)) ? ` · ${inProgress.get(productLabel(par.products))} deja comandate` : ""}</small></span>
                  <input name={`remaining_${par.product_id}`} type="number" inputMode="numeric" min={0} max={999999} placeholder="Rămase" aria-label={`Bucăți rămase: ${productLabel(par.products)}`}/>
                </label>)}
                <button className="button button-primary" type="submit">Trimite cererea</button>
              </form>}
          </section>

          <section className="admin-card partner-list-section">
            <div className="admin-card-heading"><h2>Coșul curent</h2><p>{openCart?.countdown_started_at ? `Început ${formatDateTime(openCart.countdown_started_at)}. Livrarea pleacă cel târziu în 48h.` : "Coșul se umple până la livrare, apoi se golește."}</p></div>
            {!openCart || openCart.partner_cart_items.length === 0 ? <p className="admin-empty-note">Coșul este gol.</p>
              : <ul className="par-list partner-lines">{(openCart.partner_cart_items as Line[]).map(line => <li key={line.id}>
                <span>{productLabel(line.products)}</span>
                <span className="line-end"><strong>{line.quantity_needed} buc.</strong><form action={removeOwnItem}><input type="hidden" name="item_id" value={line.id}/><button className="text-button" type="submit">Scoate</button></form></span>
              </li>)}</ul>}
          </section>

          {onTheWay.length > 0 && <section className="admin-card partner-list-section">
            <div className="admin-card-heading"><h2>În pregătire pentru livrare</h2><p>Aceste produse sunt pregătite în depozit și pleacă spre tine.</p></div>
            <ul className="par-list partner-lines">{onTheWay.flatMap(cart => cart.partner_cart_items as Line[]).map(line => <li key={line.id}><span>{productLabel(line.products)}</span><strong>{line.quantity_needed} buc.</strong></li>)}</ul>
          </section>}

          <section className="admin-card partner-list-section">
            <div className="admin-card-heading"><h2>Istoric livrări</h2></div>
            {history.length === 0 ? <p className="admin-empty-note">Nicio livrare încă.</p> : <div className="partner-list">
              {history.map(cart => <article key={cart.id} className="partner-card">
                <h3 className="history-title">Livrată {formatDateTime(cart.delivered_at)}</h3>
                <ul className="par-list">{(cart.partner_cart_items as Line[]).map(line => <li key={line.id}><span>{productLabel(line.products)}</span><strong>{line.quantity_needed} buc.</strong></li>)}</ul>
              </article>)}
            </div>}
          </section>
        </>}
      </div>
    </main>
  );
}
