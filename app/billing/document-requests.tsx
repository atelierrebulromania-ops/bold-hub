"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { formatDateTime } from "@/lib/orders";
import { documentTotals, formatMoney, lineDiscount } from "@/lib/pricing";
import type { BocpInvoiceMatch } from "@/lib/bocp/invoice-lookup";
import { confirmProformaCancelled, findDocumentInvoice, markDocumentInvoiced } from "./actions";

// Proformas that reach billing directly: invoice requests (no warehouse) and cancellations.
export type BillingDocument = {
  id: string;
  number: string | null;
  client_name: string;
  client_vat_id: string | null;
  discount_percent: number;
  account_id: string;
  bocp_order_id: string | null;
  bocp_proforma_total: number | null;
  invoice_requested_at: string | null;
  invoiced_at: string | null;
  invoiced_by: string | null;
  invoice_number: string | null;
  bocp_invoice_id: string | null;
  cancel_requested_at: string | null;
  cancel_reason: string | null;
  status: string;
  sales_document_items: { sku: string; name: string; quantity: number; unit_price: number; vat_percent: number; discount_percent: number | null; position: number }[];
};

const downloadIcon = <svg className="button-icon" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 4v11m0 0-4.5-4.5M12 15l4.5-4.5M5 19h14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>;

function units(document: BillingDocument) {
  return document.sales_document_items.reduce((sum, item) => sum + item.quantity, 0);
}

function total(document: BillingDocument) {
  return document.bocp_proforma_total ?? documentTotals(document.sales_document_items, document.discount_percent).total;
}

function formatDay(value: string) {
  return new Intl.DateTimeFormat("ro-RO", { day: "2-digit", month: "short", year: "numeric" }).format(new Date(`${value}T12:00:00`));
}

export function DocumentRequests({ toInvoice, toCancel, history, view, canInvoice, names }: {
  toInvoice: BillingDocument[]; toCancel: BillingDocument[]; history: BillingDocument[]; view: "invoice" | "history";
  canInvoice: boolean; names: Record<string, string>;
}) {
  const router = useRouter();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ ok: boolean; message: string } | null>(null);
  const [invoiceNumber, setInvoiceNumber] = useState("");
  const [found, setFound] = useState<{ invoice: BocpInvoiceMatch; warning: string | null } | null>(null);
  const [searching, startSearch] = useTransition();
  const [pending, startTransition] = useTransition();
  const all = [...toInvoice, ...toCancel, ...history];
  const selected = all.find((document) => document.id === selectedId) ?? null;
  const name = (id: string | null) => (id ? names[id] ?? "Utilizator" : "—");

  const open = (id: string) => { setSelectedId(id); setFeedback(null); setInvoiceNumber(""); setFound(null); };
  const close = () => { setSelectedId(null); setFeedback(null); };

  useEffect(() => {
    if (!selectedId) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") close(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selectedId]);

  function search(documentId: string) {
    setFound(null);
    setFeedback(null);
    startSearch(async () => {
      const result = await findDocumentInvoice(documentId, invoiceNumber);
      if (result.ok) setFound({ invoice: result.invoice, warning: result.warning });
      else setFeedback({ ok: false, message: result.message });
    });
  }

  function run(action: () => Promise<{ ok: boolean; message: string }>) {
    startTransition(async () => {
      const result = await action();
      setFeedback(result);
      router.refresh();
      if (result.ok) close();
    });
  }

  const card = (document: BillingDocument, kind: "invoice" | "cancel") => (
    <button key={document.id} type="button" className={`order-card ${selectedId === document.id ? "selected" : ""}`} onClick={() => open(document.id)}>
      <div className="card-top"><span className="invoice">{document.client_name}</span></div>
      <div className="billing-card-chips"><span className={`item-flag ${kind === "cancel" ? "no-ean" : "gift"}`}>{kind === "cancel" ? "Anulează proforma" : "Factură din proformă"}</span></div>
      <p className="card-subtitle">{document.number} · {formatMoney(total(document))} lei · {units(document)} buc.</p>
      <div className="card-bottom"><span>{kind === "cancel" ? `Cerută ${formatDateTime(document.cancel_requested_at)}` : `Cerută ${formatDateTime(document.invoice_requested_at)}`} · {name(document.account_id)}</span><span className="card-arrow" aria-hidden="true">›</span></div>
    </button>
  );

  return (
    <>
      {view === "invoice" && (toInvoice.length > 0 || toCancel.length > 0) && <div className="document-requests">
        {toCancel.length > 0 && <><h3 className="board-subtitle">Proforme de anulat în BOCP</h3><div className="returns-grid">{toCancel.map((document) => card(document, "cancel"))}</div></>}
        {toInvoice.length > 0 && <><h3 className="board-subtitle">Proforme de facturat (fără depozit)</h3><div className="returns-grid">{toInvoice.map((document) => card(document, "invoice"))}</div></>}
      </div>}

      {view === "history" && history.length > 0 && <div className="document-requests">
        <h3 className="board-subtitle">Facturi din proforme</h3>
        <div className="handed-table-wrap"><table className="handed-table">
          <thead><tr><th>Facturată la</th><th>Nr. factură</th><th>Client</th><th>Proformă</th><th>Agent</th><th>Facturată de</th><th>Factură</th></tr></thead>
          <tbody>{history.map((document) => (
            <tr key={document.id} className={`handed-row ${selectedId === document.id ? "selected" : ""}`} onClick={() => open(document.id)}>
              <td className="nowrap">{formatDateTime(document.invoiced_at)}</td>
              <td className="nowrap strong">{document.invoice_number ?? "—"}</td>
              <td><button type="button" className="row-button strong" onClick={(event) => { event.stopPropagation(); open(document.id); }}>{document.client_name}</button></td>
              <td className="nowrap">{document.number}</td>
              <td className="nowrap">{name(document.account_id)}</td>
              <td className="nowrap">{name(document.invoiced_by)}</td>
              <td className="nowrap">{document.bocp_invoice_id && <a className="icon-link" href={`/account/offers/${document.id}/invoice`} target="_blank" rel="noopener noreferrer" onClick={(event) => event.stopPropagation()}
                aria-label={`Descarcă factura ${document.invoice_number ?? ""}`} title="Descarcă factura">{downloadIcon}</a>}</td>
            </tr>
          ))}</tbody>
        </table></div>
      </div>}

      {selected && <div className="detail-backdrop" onClick={close} aria-hidden="true" />}
      {selected && (
        <aside className="detail-panel" aria-label={`Proforma ${selected.number ?? ""}`}>
          <div className="detail-header"><div><p className="eyebrow">Proformă {selected.number}</p><h2>{selected.client_name}</h2></div><button className="close-button" aria-label="Închide detaliile" onClick={close}>×</button></div>
          <div className="detail-scroll">
            <div className="detail-meta"><span className={`status-badge ${selected.invoiced_at ? "handed" : ""}`}>{selected.invoiced_at ? "Facturată" : selected.status === "cancel_requested" ? "De anulat în BOCP" : "De facturat"}</span></div>
            {selected.status === "cancel_requested" && <section className="detail-section"><h3>Cerere de anulare</h3>
              <p className="detail-primary">Anulează în BOCP proforma {selected.number} pentru {selected.client_name}.</p>
              <p>Stocul rezervat de proformă a fost deja eliberat de aplicație.{selected.cancel_reason ? ` Motiv: ${selected.cancel_reason}` : ""}</p>
            </section>}
            <section className="detail-section"><div className="section-line"><h3>Produse</h3><span>{units(selected)} buc.</span></div>
              <div className="item-list">{[...selected.sales_document_items].sort((a, b) => a.position - b.position).map((item) => (
                <div className="order-item" key={item.sku}><div><strong>{item.name}</strong><small>SKU {item.sku} · {formatMoney(item.unit_price)} lei fără TVA</small></div>
                  {lineDiscount(item, selected.discount_percent) > 0 && <span className="item-flag gift">−{lineDiscount(item, selected.discount_percent)}%</span>}<b>×{item.quantity}</b></div>
              ))}</div>
            </section>
            <section className="detail-section"><h3>Condiții</h3>
              <dl className="detail-facts">
                <dt>Proformă</dt><dd><strong>{selected.number}</strong>{selected.bocp_order_id ? ` · comanda BOCP #${selected.bocp_order_id}` : ""}</dd>
                <dt>Total proformă</dt><dd>{formatMoney(total(selected))} lei cu TVA</dd>
                <dt>Discount</dt><dd>{selected.discount_percent > 0 ? `${selected.discount_percent}% general` : "Fără general"}{selected.sales_document_items.some((item) => item.discount_percent !== null) ? " · unele produse au discount propriu (vezi lista)" : ""}</dd>
                <dt>CUI client</dt><dd>{selected.client_vat_id ?? "—"}</dd>
                <dt>Agent</dt><dd>{name(selected.account_id)}</dd>
                {selected.invoiced_at && <><dt>Nr. factură</dt><dd><strong>{selected.invoice_number}</strong></dd><dt>Facturată</dt><dd>{formatDateTime(selected.invoiced_at)} · {name(selected.invoiced_by)}</dd></>}
              </dl>
              <p>Factura se emite în BOCP pe baza proformei (aceleași prețuri și discount).</p>
            </section>
            <a className="button button-outline invoice-button" href={`/account/offers/${selected.id}/proforma`} target="_blank" rel="noopener noreferrer">{downloadIcon}Proforma (PDF BOCP)</a>
            {selected.invoiced_at && selected.bocp_invoice_id && <a className="button button-outline invoice-button" href={`/account/offers/${selected.id}/invoice`} target="_blank" rel="noopener noreferrer">{downloadIcon}Descarcă factura</a>}
            {feedback && <p className={`action-feedback ${feedback.ok ? "success" : "error"}`} role="status" aria-live="polite">{feedback.message}</p>}
          </div>
          {canInvoice && selected.status === "cancel_requested" && <div className="detail-actions">
            <button type="button" className="button button-primary" disabled={pending} onClick={() => run(() => confirmProformaCancelled(selected.id))}>Am anulat proforma în BOCP</button>
          </div>}
          {canInvoice && selected.status === "issued" && !selected.invoiced_at && <div className="detail-actions">
            {found && <div className="invoice-found" role="status">
              <strong>✓ {found.invoice.number}</strong>
              <span>{found.invoice.clientName ?? "Client necunoscut"} · {formatDay(found.invoice.date)}{found.invoice.total ? ` · ${found.invoice.total} ${found.invoice.currency ?? "RON"}` : ""}</span>
              {found.warning && <em>{found.warning}</em>}
            </div>}
            <form className="invoice-confirm" onSubmit={(event) => { event.preventDefault(); if (invoiceNumber.trim()) search(selected.id); }}>
              <label htmlFor="document-invoice-number">Nr. factură BOCP</label>
              <input id="document-invoice-number" value={invoiceNumber} maxLength={60} autoComplete="off" autoFocus
                onChange={(event) => { setInvoiceNumber(event.target.value); setFound(null); }} placeholder="ex. B2BREB-596" />
              <button type="submit" className="button button-outline" disabled={searching || pending || !invoiceNumber.trim()}>{searching ? "Caut…" : "Caută în BOCP"}</button>
            </form>
            <button type="button" className="button button-primary" disabled={pending || searching || !found}
              title={found ? undefined : "Caută mai întâi factura în BOCP"} onClick={() => run(() => markDocumentInvoiced(selected.id, invoiceNumber))}>Facturat</button>
          </div>}
        </aside>
      )}
    </>
  );
}
