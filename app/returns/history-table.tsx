"use client";

import { useEffect, useState } from "react";
import { formatDateTime, returnReasonLabels, type ReturnReason } from "@/lib/orders";

export type ReturnHistoryRow = {
  id: string;
  reason: ReturnReason;
  registered_at: string;
  restocked_at: string | null;
  restocked_by: string | null;
  restock_note: string | null;
  restocked_with_remarks: boolean;
  online_orders: {
    invoice_number: string;
    bocp_order_id: string | null;
    source: "shopify" | "marketplace";
    customer_name: string | null;
    customer_phone: string | null;
    shipping_address: string | null;
    completed_at: string | null;
    online_order_items: { id: string; quantity: number; products: { name: string; sku: string; variant_label: string | null } | null }[];
  } | null;
};

function units(row: ReturnHistoryRow) {
  return row.online_orders?.online_order_items.reduce((sum, line) => sum + line.quantity, 0) ?? 0;
}

function Outcome({ row }: { row: ReturnHistoryRow }) {
  return row.restocked_with_remarks
    ? <span className="outcome-chip remarks">Cu mențiuni</span>
    : <span className="outcome-chip ok">Procesat cu succes</span>;
}

export function ReturnsHistoryTable({ rows, operatorNames }: { rows: ReturnHistoryRow[]; operatorNames: Record<string, string> }) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = rows.find((row) => row.id === selectedId) ?? null;
  const order = selected?.online_orders ?? null;
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
        <thead><tr><th>Procesat la</th><th>Factură</th><th>Sursă</th><th>Client</th><th>Motiv</th><th>Produse</th><th>Rezultat</th><th>Operator</th></tr></thead>
        <tbody>{rows.map((row) => (
          <tr key={row.id} className={`handed-row ${selectedId === row.id ? "selected" : ""}`} onClick={() => setSelectedId(row.id)}>
            <td className="nowrap">{formatDateTime(row.restocked_at)}</td>
            <td className="nowrap strong"><button type="button" className="row-button" onClick={(event) => { event.stopPropagation(); setSelectedId(row.id); }} aria-label={`Vezi returul facturii ${row.online_orders?.invoice_number ?? ""}`}>#{row.online_orders?.invoice_number ?? "—"}</button></td>
            <td>{row.online_orders && <span className={`source-tag ${row.online_orders.source}`}>{row.online_orders.source === "shopify" ? "Shopify" : "Marketplace"}</span>}</td>
            <td><span className="strong">{row.online_orders?.customer_name ?? "—"}</span></td>
            <td className="nowrap">{returnReasonLabels[row.reason]}</td>
            <td className="nowrap">{units(row)}</td>
            <td className="nowrap"><Outcome row={row} /></td>
            <td className="nowrap">{operator(row.restocked_by)}</td>
          </tr>
        ))}</tbody>
      </table></div>

      {selected && <div className="detail-backdrop" onClick={() => setSelectedId(null)} aria-hidden="true" />}
      {selected && (
        <aside className="detail-panel" aria-label={`Detalii retur ${order?.invoice_number ?? ""}`}>
          <div className="detail-header"><div><p className="eyebrow">Factură #{order?.invoice_number ?? "—"}</p><h2>Detalii retur</h2></div><button className="close-button" aria-label="Închide detaliile" onClick={() => setSelectedId(null)}>×</button></div>
          <div className="detail-scroll">
            <div className="detail-meta"><Outcome row={selected} />{order && <span>{order.source === "shopify" ? "Shopify" : "Marketplace"}</span>}</div>
            {order?.bocp_order_id && <p className="detail-ref">Comandă BOCP: {order.bocp_order_id}</p>}
            {selected.restock_note && <section className="detail-section"><h3>{selected.restocked_with_remarks ? "Mențiuni" : "Notă"}</h3><p className="history-note">{selected.restock_note}</p></section>}
            <section className="detail-section"><h3>Retur</h3>
              <dl className="detail-facts">
                <dt>Motiv</dt><dd>{returnReasonLabels[selected.reason]}</dd>
                <dt>Predată</dt><dd>{formatDateTime(order?.completed_at ?? null)}</dd>
                <dt>Înregistrat</dt><dd>{formatDateTime(selected.registered_at)}</dd>
                <dt>Procesat</dt><dd>{formatDateTime(selected.restocked_at)}</dd>
                <dt>Operator</dt><dd>{operator(selected.restocked_by)}</dd>
              </dl>
            </section>
            <section className="detail-section"><h3>Client</h3><p className="detail-primary">{order?.customer_name ?? "Client neprecizat"}</p>{order?.shipping_address && <p>{order.shipping_address}</p>}{order?.customer_phone && <p>{order.customer_phone}</p>}</section>
            <section className="detail-section"><div className="section-line"><h3>Produse</h3><span>{units(selected)} {units(selected) === 1 ? "bucată" : "bucăți"}</span></div>
              <div className="item-list">{order?.online_order_items.map((line) => <div className="order-item" key={line.id}><div><strong>{line.products?.name ?? "Produs"}</strong><small>{line.products?.variant_label ? `${line.products.variant_label} · ` : ""}SKU {line.products?.sku ?? "—"}</small></div><b>×{line.quantity}</b></div>)}</div>
            </section>
          </div>
        </aside>
      )}
    </>
  );
}
