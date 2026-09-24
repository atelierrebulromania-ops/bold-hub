"use client";

import { useEffect, useState } from "react";
import { formatDateTime } from "@/lib/orders";

export type HandedOrder = {
  id: string;
  status: string;
  invoice_number: string;
  bocp_order_id: string | null;
  source: "shopify" | "marketplace";
  customer_name: string | null;
  customer_phone: string | null;
  customer_email: string | null;
  shipping_address: string | null;
  claimed_by: string | null;
  claimed_at: string | null;
  ready_at: string | null;
  completed_at: string | null;
  created_at: string;
  invoice_pdf_url: string | null;
  online_order_items: { id: string; quantity: number; products: { name: string; sku: string; variant_label: string | null } | null }[];
};

const downloadIcon = <svg className="button-icon" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 4v11m0 0-4.5-4.5M12 15l4.5-4.5M5 19h14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>;

function itemCount(order: HandedOrder) {
  return order.online_order_items.reduce((sum, item) => sum + item.quantity, 0);
}

export function HandedTable({ orders, operatorNames }: { orders: HandedOrder[]; operatorNames: Record<string, string> }) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = orders.find((order) => order.id === selectedId) ?? null;
  const operator = (id: string | null) => (id ? operatorNames[id] ?? "Operator" : "—");

  useEffect(() => {
    if (!selected) return;
    const close = (event: KeyboardEvent) => { if (event.key === "Escape") setSelectedId(null); };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [selected]);

  return (
    <>
      <div className="handed-table-wrap"><table className="handed-table">
        <thead><tr><th>Predată la</th><th>Factură</th><th>AWB</th><th>Sursă</th><th>Client</th><th>Produse</th><th>Operator</th></tr></thead>
        <tbody>{orders.map((order) => (
          <tr key={order.id} className={`handed-row ${selectedId === order.id ? "selected" : ""}`} onClick={() => setSelectedId(order.id)}>
            <td className="nowrap">{formatDateTime(order.completed_at)}</td>
            <td className="nowrap strong"><button type="button" className="row-button" onClick={(event) => { event.stopPropagation(); setSelectedId(order.id); }} aria-label={`Vezi detaliile comenzii cu factura ${order.invoice_number}`}>#{order.invoice_number}</button></td>
            {/* AWB arrives with the Cargus integration; until then there is nothing to show. */}
            <td className="nowrap muted-cell">—</td>
            <td><span className={`source-tag ${order.source}`}>{order.source === "shopify" ? "Shopify" : "Marketplace"}</span></td>
            <td><span className="strong">{order.customer_name ?? "—"}</span>{order.shipping_address && <small>{order.shipping_address}</small>}</td>
            <td className="nowrap">{itemCount(order)}</td>
            <td className="nowrap">{operator(order.claimed_by)}</td>
          </tr>
        ))}</tbody>
      </table></div>

      {selected && <div className="detail-backdrop" onClick={() => setSelectedId(null)} aria-hidden="true" />}
      {selected && (
        <aside className="detail-panel" aria-label={`Detalii comandă ${selected.invoice_number}`}>
          <div className="detail-header"><div><p className="eyebrow">Factură #{selected.invoice_number}</p><h2>Detalii comandă</h2></div><button className="close-button" aria-label="Închide detaliile" onClick={() => setSelectedId(null)}>×</button></div>
          <div className="detail-scroll">
            <div className="detail-meta"><span className="status-badge handed">{selected.status === "returned" ? "Returnată" : "Predată curierului"}</span><span>{selected.source === "shopify" ? "Shopify" : "Marketplace"}</span></div>
            {selected.bocp_order_id && <p className="detail-ref">Comandă BOCP: {selected.bocp_order_id}</p>}
            <section className="detail-section"><h3>Livrare</h3>
              <dl className="detail-facts">
                <dt>AWB</dt><dd>—</dd>
                <dt>Operator</dt><dd>{operator(selected.claimed_by)}</dd>
                <dt>Importată</dt><dd>{formatDateTime(selected.created_at)}</dd>
                <dt>Preluată</dt><dd>{formatDateTime(selected.claimed_at)}</dd>
                <dt>Pregătită</dt><dd>{formatDateTime(selected.ready_at)}</dd>
                <dt>Predată</dt><dd>{formatDateTime(selected.completed_at)}</dd>
              </dl>
            </section>
            <section className="detail-section"><h3>Client</h3><p className="detail-primary">{selected.customer_name ?? "Client neprecizat"}</p>{selected.shipping_address && <p>{selected.shipping_address}</p>}{selected.customer_phone && <p>{selected.customer_phone}</p>}{selected.customer_email && <p>{selected.customer_email}</p>}</section>
            <section className="detail-section"><div className="section-line"><h3>Produse</h3><span>{itemCount(selected)} {itemCount(selected) === 1 ? "bucată" : "bucăți"}</span></div>
              <div className="item-list">{selected.online_order_items.map((item) => <div className="order-item" key={item.id}><div><strong>{item.products?.name ?? "Produs"}</strong><small>{item.products?.variant_label ? `${item.products.variant_label} · ` : ""}SKU {item.products?.sku ?? "—"}</small></div><b>×{item.quantity}</b></div>)}</div>
            </section>
            {selected.invoice_pdf_url && <a className="button button-outline invoice-button" href={selected.invoice_pdf_url} target="_blank" rel="noopener noreferrer">{downloadIcon}Descarcă factura</a>}
          </div>
        </aside>
      )}
    </>
  );
}
