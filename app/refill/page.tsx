import { AppShell } from "@/components/app-shell";
import { LiveRefresh } from "@/components/live-refresh";
import { requireRole } from "@/lib/auth";
import { formatDateTime } from "@/lib/orders";
import { addRefill, cancelDelivery, confirmReady, createDelivery, handToDriver, releaseCart, removeItem } from "./actions";

export const dynamic = "force-dynamic";

const notices: Record<string, string> = {
  added: "Cererea a fost adăugată în coș, iar stocul a fost rezervat.",
  removed: "Produsul a fost scos din coș, iar rezervarea a fost anulată.",
  delivery_created: "Livrarea a fost creată. Pregătește produsele și confirmă.",
  delivery_cancelled: "Propunerea de livrare a fost anulată. Coșurile au revenit deschise.",
  cart_released: "Coșul a fost scos din livrare și a revenit deschis.",
  ready: "Livrarea este pregătită. Facturarea a fost notificată.",
  handed: "Livrarea a fost predată șoferului/curierului. Stocul rezervat a fost eliberat.",
};

const errors: Record<string, string> = {
  invalid: "Verifică revânzătorul, SKU-ul, cantitatea și sursa.",
  product_missing: "SKU-ul nu există în catalogul activ.",
  no_carts: "Bifează cel puțin un coș pentru livrare.",
  stale: "Starea s-a schimbat între timp. Pagina a fost reîncărcată.",
  save_failed: "Nu am putut salva. Încearcă din nou.",
};

const triggerLabels: Record<string, string> = {
  manual: "Manual",
  important_client: "Client important",
  countdown_48h: "Countdown 48h",
};

type Line = { id: string; quantity_needed: number; products: { name: string; sku: string; variant_label: string | null } | null };

function hoursSince(value: string | null) {
  return value ? Math.floor((Date.now() - new Date(value).getTime()) / 3600000) : 0;
}

function Lines({ lines, removable }: { lines: Line[]; removable?: boolean }) {
  return <ul className="par-list">{lines.map(line => <li key={line.id}>
    <span>{line.products?.name ?? "Produs"}{line.products?.variant_label ? ` · ${line.products.variant_label}` : ""}<small>SKU {line.products?.sku ?? "—"}</small></span>
    <span className="line-end"><strong>{line.quantity_needed} buc.</strong>
      {removable && <form action={removeItem}><input type="hidden" name="item_id" value={line.id}/><button className="text-button" type="submit" aria-label={`Scoate ${line.products?.name ?? "produsul"} din coș`}>Scoate</button></form>}
    </span>
  </li>)}</ul>;
}

export default async function RefillPage({ searchParams }: { searchParams: Promise<{ notice?: string; error?: string }> }) {
  const { supabase, profile } = await requireRole(["admin", "operator_depozit"]);
  const params = await searchParams;
  const lineFields = "id,quantity_needed,products(name,sku,variant_label)";
  const [deliveriesResult, cartsResult, groupsResult, resellersResult, stockResult] = await Promise.all([
    supabase.from("deliveries")
      .select(`id,status,trigger_type,created_at,confirmed_at,delivery_groups(name),resellers(business_name),reseller_order_fulfillments(status,invoice_number,invoiced_at),delivery_carts(reseller_carts(id,countdown_started_at,resellers(business_name,location_name,is_important_client),reseller_cart_items(${lineFields})))`)
      .in("status", ["pending_confirmation", "confirmed"]).order("created_at").limit(100),
    supabase.from("reseller_carts")
      .select(`id,countdown_started_at,resellers(id,business_name,location_name,is_important_client,reseller_delivery_groups(delivery_group_id)),reseller_cart_items(${lineFields})`)
      .eq("status", "open").order("countdown_started_at", { ascending: true, nullsFirst: false }).limit(300),
    supabase.from("delivery_groups").select("id,name").order("name").limit(500),
    supabase.from("resellers").select("id,business_name,location_name").eq("active", true).order("business_name").limit(1000),
    supabase.from("warehouse_stock").select("quantity_reserved,quantity_bocp_global,products(name,sku,variant_label)")
      .gt("quantity_reserved", 0).order("quantity_reserved", { ascending: false }).limit(200),
  ]);
  const loadError = [deliveriesResult, cartsResult, groupsResult, resellersResult, stockResult].some(result => result.error);
  const deliveries = deliveriesResult.data ?? [];
  const carts = (cartsResult.data ?? []).filter(cart => cart.reseller_cart_items.length > 0);
  const groups = groupsResult.data ?? [];
  const resellers = resellersResult.data ?? [];
  const reserved = stockResult.data ?? [];
  const groupNames = new Map(groups.map(group => [group.id, group.name]));

  // Show each open cart under the reseller's route (first group by name, like the database).
  const byGroup = new Map<string, typeof carts>();
  for (const cart of carts) {
    const names = (cart.resellers?.reseller_delivery_groups ?? [])
      .map(link => groupNames.get(link.delivery_group_id)).filter((name): name is string => !!name).sort();
    const key = names[0] ?? "Fără Delivery Group";
    byGroup.set(key, [...(byGroup.get(key) ?? []), cart]);
  }
  const pending = deliveries.filter(delivery => delivery.status === "pending_confirmation");
  const confirmed = deliveries.filter(delivery => delivery.status === "confirmed");

  return (
    <AppShell profile={profile} active="/refill" section="Operațiuni" title="Refill revânzători"
      note={{ title: "Countdown 48h", text: "Coșurile vechi de 48h devin automat livrări propuse." }}>
      <LiveRefresh channel="boldhub-refill" tables={["reseller_carts", "reseller_cart_items", "deliveries", "reseller_order_fulfillments"]}/>
      <div className="page-heading"><div><p className="eyebrow">FLUX 1 · REFILL</p><h1>Refill revânzători</h1><p className="muted">Coșuri, rezervare pe raft, livrări grupate și predare către șofer sau curier.</p></div><span className="page-heading-chip"><span className="live-dot"/> În timp real</span></div>
      {params.notice && notices[params.notice] && <p className="preview-alert success admin-feedback" role="status">{notices[params.notice]}</p>}
      {params.error && errors[params.error] && <p className="notice error admin-feedback" role="alert">{errors[params.error]}</p>}
      {loadError ? <p className="notice error" role="alert">Datele de refill nu pot fi încărcate acum.</p> : <>
        <div className="reseller-summary" aria-label="Rezumat refill">
          <div><strong>{carts.length}</strong><span>coșuri deschise</span></div>
          <div><strong>{pending.length}</strong><span>livrări de confirmat</span></div>
          <div><strong>{confirmed.length}</strong><span>la facturare / de predat</span></div>
          <div><strong>{reserved.reduce((sum, row) => sum + row.quantity_reserved, 0)}</strong><span>buc. rezervate</span></div>
        </div>

        <section className="admin-card" aria-labelledby="deliveries-title">
          <div className="admin-card-heading"><h2 id="deliveries-title">Livrări în lucru</h2><p>Propunerile (manual, client important, countdown 48h) așteaptă confirmarea ta. După confirmare merg la facturare, apoi le predai.</p></div>
          {deliveries.length === 0 ? <p className="admin-empty-note">Nicio livrare în lucru.</p> : <div className="reseller-list">
            {deliveries.map(delivery => {
              const deliveryCarts = delivery.delivery_carts.map(link => link.reseller_carts).filter(cart => cart !== null);
              const fulfillment = delivery.reseller_order_fulfillments;
              const invoiced = fulfillment?.status === "invoiced";
              return <article key={delivery.id} className={delivery.trigger_type === "countdown_48h" && delivery.status === "pending_confirmation" ? "reseller-card alert-card" : "reseller-card"}>
                <div className="reseller-card-heading">
                  <div>
                    <h3>{delivery.delivery_groups?.name ?? "Livrare fără grup"}</h3>
                    <p>{deliveryCarts.length} {deliveryCarts.length === 1 ? "locație" : "locații"} · propusă {formatDateTime(delivery.created_at)}{delivery.resellers ? ` · declanșată de ${delivery.resellers.business_name}` : ""}</p>
                    <small>{delivery.status === "pending_confirmation" ? "Pregătește produsele de pe raftul rezervat, apoi confirmă." : invoiced ? `Facturată (${fulfillment?.invoice_number}) — poate pleca.` : "Așteaptă factura de la facturare."}</small>
                  </div>
                  <div className="reseller-tags"><span className={`reseller-tag trigger-${delivery.trigger_type}`}>{triggerLabels[delivery.trigger_type]}</span></div>
                </div>
                <div className="reseller-card-grid">
                  {deliveryCarts.map(cart => <div key={cart.id}>
                    <h4>{cart.resellers?.business_name ?? "Revânzător"}<small className="fulfillment-location"> · {cart.resellers?.location_name}</small></h4>
                    <Lines lines={cart.reseller_cart_items}/>
                    {delivery.status === "pending_confirmation" && <form action={releaseCart}><input type="hidden" name="delivery_id" value={delivery.id}/><input type="hidden" name="cart_id" value={cart.id}/><button className="text-button" type="submit">Scoate din livrare</button></form>}
                  </div>)}
                </div>
                <div className="return-actions">
                  {delivery.status === "pending_confirmation" && <>
                    <form action={confirmReady}><input type="hidden" name="delivery_id" value={delivery.id}/><button className="button button-primary" type="submit">Confirmă: produsele sunt pregătite</button></form>
                    <form action={cancelDelivery}><input type="hidden" name="delivery_id" value={delivery.id}/><button className="button button-quiet" type="submit">Anulează propunerea</button></form>
                  </>}
                  {delivery.status === "confirmed" && <form action={handToDriver}><input type="hidden" name="delivery_id" value={delivery.id}/><button className="button button-primary" type="submit" disabled={!invoiced}>Predat șoferului / curierului</button></form>}
                </div>
              </article>;
            })}
          </div>}
        </section>

        <section className="admin-card reseller-list-section" aria-labelledby="carts-title">
          <div className="admin-card-heading"><h2 id="carts-title">Coșuri deschise</h2><p>Bifează coșurile care pleacă împreună și creează o livrare manuală.</p></div>
          {carts.length === 0 ? <p className="admin-empty-note">Niciun coș deschis.</p> : <>
            <form id="new-delivery" action={createDelivery} className="admin-inline admin-mini-form delivery-create">
              <select name="group_id" defaultValue="" aria-label="Delivery Group pentru livrare"><option value="">Fără grup</option>{groups.map(group => <option key={group.id} value={group.id}>{group.name}</option>)}</select>
              <button className="button button-primary" type="submit">Creează livrare din coșurile bifate</button>
            </form>
            {[...byGroup.entries()].map(([groupName, groupCarts]) => <div key={groupName} className="cart-group">
              <h3 className="cart-group-title">{groupName}</h3>
              <div className="reseller-list">{groupCarts.map(cart => {
                const hours = hoursSince(cart.countdown_started_at);
                return <article key={cart.id} className="reseller-card">
                  <div className="reseller-card-heading">
                    <label className="cart-select"><input type="checkbox" name="cart_id" value={cart.id} form="new-delivery"/>
                      <span><strong>{cart.resellers?.business_name}</strong><small>{cart.resellers?.location_name}</small></span></label>
                    <div className="reseller-tags">
                      {cart.resellers?.is_important_client && <span className="reseller-tag important">Important</span>}
                      <span className={hours >= 36 ? "reseller-tag countdown-warn" : "reseller-tag"}>{hours}h / 48h</span>
                    </div>
                  </div>
                  <div className="return-items"><Lines lines={cart.reseller_cart_items} removable/></div>
                </article>;
              })}</div>
            </div>)}
          </>}
        </section>

        <div className="reseller-setup-grid reseller-list-section">
          <section className="admin-card" aria-labelledby="manual-title">
            <div className="admin-card-heading"><h2 id="manual-title">Adaugă cerere primită</h2><p>Pentru cererile venite pe WhatsApp sau telefon, până la automatizarea WhatsApp.</p></div>
            {resellers.length === 0 ? <p className="admin-empty-note">Nu există revânzători activi.</p> : <form action={addRefill} className="admin-form">
              <label htmlFor="refill-reseller">Revânzător</label>
              <select id="refill-reseller" name="reseller_id" required defaultValue=""><option value="" disabled>Alege locația</option>{resellers.map(reseller => <option key={reseller.id} value={reseller.id}>{reseller.business_name} · {reseller.location_name}</option>)}</select>
              <label htmlFor="refill-sku">SKU produs</label>
              <input id="refill-sku" name="sku" maxLength={100} required placeholder="Ex. IST-LOT-250"/>
              <div className="admin-inline">
                <div className="grow"><label htmlFor="refill-qty">Cantitate</label><input id="refill-qty" name="quantity" type="number" min={1} max={100000} required placeholder="Buc."/></div>
                <div className="grow"><label htmlFor="refill-source">Sursă</label><select id="refill-source" name="source" defaultValue="whatsapp"><option value="whatsapp">WhatsApp</option><option value="telefon">Telefon</option><option value="app">Altă sursă</option></select></div>
              </div>
              <button className="button button-primary" type="submit">Adaugă în coș și rezervă</button>
            </form>}
          </section>
          <section className="admin-card" aria-labelledby="reserved-title">
            <div className="admin-card-heading"><h2 id="reserved-title">Stoc rezervat</h2><p>Ce trebuie să stea pe raftul rezervat. Disponibilul real = stoc BOCP − rezervat.</p></div>
            {reserved.length === 0 ? <p className="admin-empty-note">Nimic rezervat.</p> : <ul className="admin-simple-list dashboard-list">{reserved.map((row, index) => <li key={index}>
              <span>{row.products?.name ?? "Produs"}{row.products?.variant_label ? ` · ${row.products.variant_label}` : ""}<small>SKU {row.products?.sku} · {row.quantity_bocp_global > 0 ? `BOCP ${row.quantity_bocp_global}` : "stoc BOCP nesincronizat"}</small></span>
              <strong className={row.quantity_bocp_global > 0 && row.quantity_reserved > row.quantity_bocp_global ? "over-reserved" : undefined}>{row.quantity_reserved} buc.</strong>
            </li>)}</ul>}
          </section>
        </div>
      </>}
    </AppShell>
  );
}
