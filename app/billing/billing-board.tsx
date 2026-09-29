"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { formatDateTime } from "@/lib/orders";
import { describeRules, discountFor } from "@/lib/pricing";
import type { BocpInvoiceMatch } from "@/lib/bocp/invoice-lookup";
import { findCartInvoice, markCartInvoiced, retryCartReservation } from "./actions";

export type BillingCart = {
  id: string;
  prepared_at: string | null;
  delivered_at: string | null;
  delivered_by: string | null;
  invoiced_at: string | null;
  invoiced_by: string | null;
  invoice_number: string | null;
  invoice_date: string | null;
  bocp_invoice_id: string | null;
  reserved_in_bocp_at: string | null;
  reserved_in_bocp_by: string | null;
  bocp_order_id: string | null;
  bocp_order_error: string | null;
  bocp_order_attempted_at: string | null;
  partners: { business_name: string; location_name: string; type: string; is_important_client: boolean; contact_phone: string; contact_email: string | null;
    partner_discounts: { category: string | null; percent: number }[] } | null;
  // The offer/proforma the cart came from: its discount replaces the client's rules.
  sales_documents: { kind: string; number: string | null; discount_percent: number; sales_document_items: { sku: string; discount_percent: number | null }[] } | null;
  partner_cart_items: { id: string; quantity_needed: number; products: { name: string; sku: string; variant_label: string | null; category: string | null } | null }[];
};

const typeLabels: Record<string, string> = { reseller: "Revânzător", horeca: "HoReCa", altul: "Altul" };

const downloadIcon = <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 4v11m0 0-4.5-4.5M12 15l4.5-4.5M5 19h14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>;

function formatDay(value: string) {
  return new Intl.DateTimeFormat("ro-RO", { day: "2-digit", month: "short", year: "numeric" }).format(new Date(`${value}T12:00:00`));
}

function units(cart: BillingCart) {
  return cart.partner_cart_items.reduce((sum, item) => sum + item.quantity_needed, 0);
}

export type BillingView = "reserve" | "invoice" | "products" | "history";

// "Produse": what currently sits in the BOCP "Rezervat" warehouse (moved there, not yet invoiced).
function reservedProducts(carts: BillingCart[]) {
  const byProduct = new Map<string, { name: string; sku: string; variant: string | null; total: number; partners: { name: string; units: number }[] }>();
  for (const cart of carts) {
    for (const item of cart.partner_cart_items) {
      const sku = item.products?.sku ?? "—";
      const entry = byProduct.get(sku) ?? { name: item.products?.name ?? "Produs", sku, variant: item.products?.variant_label ?? null, total: 0, partners: [] };
      entry.total += item.quantity_needed;
      const partner = cart.partners?.business_name ?? "Partener";
      const line = entry.partners.find((row) => row.name === partner);
      if (line) line.units += item.quantity_needed; else entry.partners.push({ name: partner, units: item.quantity_needed });
      byProduct.set(sku, entry);
    }
  }
  return [...byProduct.values()].sort((a, b) => b.total - a.total || a.name.localeCompare(b.name, "ro"));
}

export type BocpReserved = Record<string, { reserved: number; available: number }>;

export function BillingBoard({ carts, view, canInvoice, operatorNames, bocpReserved, bocpError, hideEmpty }: {
  carts: BillingCart[]; view: BillingView; canInvoice: boolean; operatorNames: Record<string, string>;
  bocpReserved?: BocpReserved | null; bocpError?: string | null; hideEmpty?: boolean;
}) {
  const router = useRouter();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ ok: boolean; message: string } | null>(null);
  const [invoiceNumber, setInvoiceNumber] = useState("");
  // The invoice found in BOCP for the typed number; "Facturat" needs it.
  const [found, setFound] = useState<{ invoice: BocpInvoiceMatch; warning: string | null } | null>(null);
  const [searching, startSearch] = useTransition();
  const [pending, startTransition] = useTransition();
  const selected = carts.find((cart) => cart.id === selectedId) ?? null;
  const name = (id: string | null) => (id ? operatorNames[id] ?? "Operator" : "—");

  const open = (id: string) => { setSelectedId(id); setFeedback(null); setInvoiceNumber(""); setFound(null); };
  const close = () => { setSelectedId(null); setFeedback(null); };

  useEffect(() => {
    if (!selectedId) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") close(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selectedId]);

  function search(cartId: string) {
    setFound(null);
    setFeedback(null);
    startSearch(async () => {
      const result = await findCartInvoice(cartId, invoiceNumber);
      if (result.ok) setFound({ invoice: result.invoice, warning: result.warning });
      else setFeedback({ ok: false, message: result.message });
    });
  }

  function reserve(cartId: string) {
    startTransition(async () => {
      const result = await retryCartReservation(cartId);
      setFeedback(result);
      router.refresh();
      if (result.ok) close();
    });
  }

  function invoice(cartId: string) {
    startTransition(async () => {
      const result = await markCartInvoiced(cartId, invoiceNumber);
      setFeedback(result);
      router.refresh();
      if (result.ok) close();
    });
  }

  const partnerChips = (cart: BillingCart) => cart.partners && <span className="partner-tile-chip-group">
    <span className={`partner-kind ${cart.partners.type}`}>{typeLabels[cart.partners.type] ?? cart.partners.type}</span>
    {cart.partners.is_important_client && <span className="priority-chip" title="Client prioritar — livrare imediată">⚡ Prioritar</span>}
  </span>;

  return (
    <>
      {view === "products" ? <ReservedProducts carts={carts} bocpReserved={bocpReserved ?? null} bocpError={bocpError ?? null} />
        : carts.length === 0 ? hideEmpty ? null : <p className="admin-empty-note">{view === "reserve" ? "Toate comenzile de pe raft sunt rezervate în BOCP." : view === "invoice" ? "Nu există comenzi B2B de facturat." : "Nicio comandă facturată încă."}</p>
        : view !== "history" ? <div className="returns-grid">
          {carts.map((cart) => (
            <button key={cart.id} type="button" className={`order-card ${selectedId === cart.id ? "selected" : ""}`} onClick={() => open(cart.id)}>
              <div className="card-top"><span className="invoice">{cart.partners?.business_name ?? "Partener"}</span></div>
              <div className="billing-card-chips">{partnerChips(cart)}{view === "reserve" && <span className={`item-flag ${cart.bocp_order_error ? "no-ean" : "gift"}`}>{cart.bocp_order_error ? "Eroare BOCP" : "Se rezervă…"}</span>}
                {view === "invoice" && !cart.reserved_in_bocp_at && <span className="item-flag no-ean" title="Stocul acestei comenzi nu este rezervat în BOCP.">Nerezervat în BOCP</span>}</div>
              <p className="card-subtitle">{units(cart)} buc. · {cart.partner_cart_items.length} {cart.partner_cart_items.length === 1 ? "produs" : "produse"}</p>
              <div className="card-bottom"><span>{view === "reserve" ? `Pe raft ${formatDateTime(cart.prepared_at)}` : `Predată ${formatDateTime(cart.delivered_at)}`}</span><span className="card-arrow" aria-hidden="true">›</span></div>
            </button>
          ))}
        </div>
        : <div className="handed-table-wrap"><table className="handed-table">
          <thead><tr><th>Facturată la</th><th>Nr. factură</th><th>Partener</th><th>Produse</th><th>Predată de</th><th>Facturată de</th><th>Factură</th></tr></thead>
          <tbody>{carts.map((cart) => (
            <tr key={cart.id} className={`handed-row ${selectedId === cart.id ? "selected" : ""}`} onClick={() => open(cart.id)}>
              <td className="nowrap">{formatDateTime(cart.invoiced_at)}</td>
              <td className="nowrap strong">{cart.invoice_number ?? "—"}</td>
              <td><button type="button" className="row-button strong" onClick={(event) => { event.stopPropagation(); open(cart.id); }}>{cart.partners?.business_name ?? "Partener"}</button><small>{cart.partners?.location_name}</small></td>
              <td className="nowrap">{units(cart)} buc.</td>
              <td className="nowrap">{name(cart.delivered_by)}</td>
              <td className="nowrap">{name(cart.invoiced_by)}</td>
              <td className="nowrap">{cart.bocp_invoice_id && <a className="icon-link" href={`/billing/invoice/${cart.id}`} target="_blank" rel="noopener noreferrer" onClick={(event) => event.stopPropagation()}
                aria-label={`Descarcă factura ${cart.invoice_number ?? ""}`} title="Descarcă factura">{downloadIcon}</a>}</td>
            </tr>
          ))}</tbody>
        </table></div>}

      {selected && <div className="detail-backdrop" onClick={close} aria-hidden="true" />}
      {selected && (
        <aside className="detail-panel" aria-label={`Comandă B2B ${selected.partners?.business_name ?? ""}`}>
          <div className="detail-header"><div><p className="eyebrow">Comandă B2B</p><h2>{selected.partners?.business_name ?? "Partener"}</h2></div><button className="close-button" aria-label="Închide detaliile" onClick={close}>×</button></div>
          <div className="detail-scroll">
            <div className="detail-meta"><span className={`status-badge ${selected.invoiced_at ? "handed" : ""}`}>{selected.invoiced_at ? "Facturată" : view === "reserve" ? "Nerezervată în BOCP" : "De facturat"}</span>{partnerChips(selected)}</div>
            <section className="detail-section"><div className="section-line"><h3>Produse</h3><span>{units(selected)} buc.</span></div>
              <div className="item-list">{selected.partner_cart_items.map((item) => {
                // From a proforma: the product's own discount there, or the document's; otherwise the client's rules.
                const source = selected.sales_documents;
                const lineDiscount = source
                  ? source.sales_document_items.find((line) => line.sku === item.products?.sku)?.discount_percent ?? source.discount_percent
                  : discountFor(selected.partners?.partner_discounts ?? [], item.products?.category ?? null);
                return <div className="order-item" key={item.id}><div><strong>{item.products?.name ?? "Produs"}</strong><small>{item.products?.variant_label ? `${item.products.variant_label} · ` : ""}SKU {item.products?.sku ?? "—"}{item.products?.category ? ` · ${item.products.category}` : ""}</small></div>
                  {lineDiscount > 0 && <span className="item-flag gift">−{lineDiscount}%</span>}<b>×{item.quantity_needed}</b></div>;
              })}</div>
            </section>
            <section className="detail-section"><h3>Condiții de preț</h3>
              {selected.sales_documents
                ? <p className="detail-primary">Din {selected.sales_documents.kind === "offer" ? "oferta" : "proforma"} {selected.sales_documents.number} · discount general {selected.sales_documents.discount_percent}%{selected.sales_documents.sales_document_items.some((line) => line.discount_percent !== null) ? ", unele produse cu discount propriu (vezi lista)" : ""}</p>
                : <p className="detail-primary">{describeRules(selected.partners?.partner_discounts ?? [])}</p>}
              <p>Prețuri de listă din BOCP; discountul se aplică la emiterea facturii.</p>
            </section>
            <section className="detail-section"><h3>Parcurs</h3>
              <dl className="detail-facts">
                <dt>Rezervată pe raft</dt><dd>{formatDateTime(selected.prepared_at)}</dd>
                <dt>Rezervată în BOCP</dt><dd>{selected.reserved_in_bocp_at ? `${formatDateTime(selected.reserved_in_bocp_at)}${selected.bocp_order_id ? ` · comanda #${selected.bocp_order_id}` : ""}` : "Încă nu"}</dd>
                <dt>Predată la facturare</dt><dd>{formatDateTime(selected.delivered_at)}</dd>
                <dt>Predată de</dt><dd>{name(selected.delivered_by)}</dd>
                {selected.invoiced_at && <><dt>Nr. factură</dt><dd><strong>{selected.invoice_number ?? "—"}</strong>{selected.invoice_date ? ` · ${formatDay(selected.invoice_date)}` : ""}</dd><dt>Facturată</dt><dd>{formatDateTime(selected.invoiced_at)}</dd><dt>Facturată de</dt><dd>{name(selected.invoiced_by)}</dd></>}
              </dl>
            </section>
            <section className="detail-section"><h3>Partener</h3><p className="detail-primary">{selected.partners?.business_name}</p><p>{selected.partners?.location_name}</p>{selected.partners?.contact_phone && <p>{selected.partners.contact_phone}</p>}{selected.partners?.contact_email && <p>{selected.partners.contact_email}</p>}</section>
            {selected.invoiced_at && selected.bocp_invoice_id && <a className="button button-outline invoice-button" href={`/billing/invoice/${selected.id}`} target="_blank" rel="noopener noreferrer">
              <svg className="button-icon" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 4v11m0 0-4.5-4.5M12 15l4.5-4.5M5 19h14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>Descarcă factura</a>}
            {feedback && <p className={`action-feedback ${feedback.ok ? "success" : "error"}`} role="status" aria-live="polite">{feedback.message}</p>}
          </div>
          {canInvoice && view === "reserve" && !selected.reserved_in_bocp_at && <div className="detail-actions">
            {selected.bocp_order_error
              ? <p className="bocp-error"><strong>BOCP:</strong> {selected.bocp_order_error}</p>
              : <p className="muted small">Comanda se trimite în BOCP când depozitul pune produsele pe raft.</p>}
            <button type="button" className="button button-primary" disabled={pending} onClick={() => reserve(selected.id)}>Reîncearcă rezervarea în BOCP</button>
          </div>}
          {canInvoice && view === "invoice" && !selected.invoiced_at && <div className="detail-actions">
            {found && <div className="invoice-found" role="status">
              <strong>✓ {found.invoice.number}</strong>
              <span>{found.invoice.clientName ?? "Client necunoscut"} · {formatDay(found.invoice.date)}{found.invoice.total ? ` · ${found.invoice.total} ${found.invoice.currency ?? "RON"}` : ""}</span>
              {found.warning && <em>{found.warning}</em>}
            </div>}
            <form className="invoice-confirm" onSubmit={(event) => { event.preventDefault(); if (invoiceNumber.trim()) search(selected.id); }}>
              <label htmlFor="invoice-number">Nr. factură BOCP</label>
              <input id="invoice-number" value={invoiceNumber} maxLength={60} autoComplete="off" autoFocus
                onChange={(event) => { setInvoiceNumber(event.target.value); setFound(null); }} placeholder="ex. B2BREB-596" />
              <button type="submit" className="button button-outline" disabled={searching || pending || !invoiceNumber.trim()}>{searching ? "Caut…" : "Caută în BOCP"}</button>
            </form>
            <button type="button" className="button button-primary" disabled={pending || searching || !found}
              title={found ? undefined : "Caută mai întâi factura în BOCP"} onClick={() => invoice(selected.id)}>Facturat</button>
          </div>}
        </aside>
      )}
    </>
  );
}

function ReservedProducts({ carts, bocpReserved, bocpError }: { carts: BillingCart[]; bocpReserved: BocpReserved | null; bocpError: string | null }) {
  const rows = reservedProducts(carts);
  const total = rows.reduce((sum, row) => sum + row.total, 0);
  if (!rows.length) return <p className="admin-empty-note">Nu există produse rezervate în BOCP pentru parteneri (rezervate și încă nefacturate).</p>;
  return (
    <div className="reserved-products">
      <p className="reserved-summary"><strong>{total} buc.</strong> din {rows.length} {rows.length === 1 ? "produs" : "produse"} rezervate în BOCP pentru {carts.length} {carts.length === 1 ? "comandă B2B" : "comenzi B2B"}, încă nefacturate.
        {bocpError ? <span className="bocp-note"> {bocpError}</span> : <span className="bocp-note"> „Rezervat în BOCP” e totalul din BOCP și include și comenzile online nefacturate.</span>}</p>
      <div className="handed-table-wrap"><table className="handed-table">
        <thead><tr><th>Produs</th><th>SKU</th><th>Pentru parteneri</th><th>Rezervat în BOCP</th><th>Disponibil BOCP</th><th>Pe parteneri</th></tr></thead>
        <tbody>{rows.map((row) => {
          const bocp = bocpReserved?.[row.sku];
          const short = bocp !== undefined && bocp.reserved < row.total;
          return (
            <tr key={row.sku}>
              <td><span className="strong">{row.name}</span>{row.variant && <small>{row.variant}</small>}</td>
              <td className="nowrap">{row.sku}</td>
              <td className="nowrap strong">{row.total} buc.</td>
              <td className={`nowrap ${short ? "stock-short" : ""}`} title={short ? "BOCP are mai puțin rezervat decât comenzile B2B" : undefined}>{bocp ? `${bocp.reserved} buc.` : "—"}</td>
              <td className="nowrap">{bocp ? `${bocp.available} buc.` : "—"}</td>
              <td><span className="reserved-partners">{row.partners.map((partner) => <span key={partner.name} className="reserved-partner">{partner.name} <b>×{partner.units}</b></span>)}</span></td>
            </tr>
          );
        })}</tbody>
      </table></div>
    </div>
  );
}
