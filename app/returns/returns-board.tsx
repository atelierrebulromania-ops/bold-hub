"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { formatDateTime, returnReasonLabels, type ReturnReason } from "@/lib/orders";
import { confirmReturn, markReturnInShopify } from "./actions";

export type ReturnRow = {
  id: string;
  reason: ReturnReason;
  status: "pending_restock" | "restocked";
  registered_at: string;
  restocked_at: string | null;
  restock_note: string | null;
  shopify_marked_manually: boolean;
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

const noteLimit = 1000;

function units(item: ReturnRow) {
  return item.online_orders?.online_order_items.reduce((sum, line) => sum + line.quantity, 0) ?? 0;
}

// canMarkShopify is the admin view: it shows the Shopify state and lets the admin mark it done.
export function ReturnsBoard({ returns, canProcess, canMarkShopify, empty }: { returns: ReturnRow[]; canProcess: boolean; canMarkShopify: boolean; empty: string }) {
  const router = useRouter();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [feedback, setFeedback] = useState<{ ok: boolean; message: string } | null>(null);
  const [pending, startTransition] = useTransition();
  const selected = returns.find((item) => item.id === selectedId) ?? null;

  const open = (id: string) => { setSelectedId(id); setNote(""); setFeedback(null); };
  const close = () => { setSelectedId(null); setFeedback(null); };

  useEffect(() => {
    if (!selectedId) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") close(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selectedId]);

  function run(action: () => Promise<{ ok: boolean; message: string }>, closeOnSuccess: boolean) {
    startTransition(async () => {
      const result = await action();
      setFeedback(result);
      router.refresh();
      if (result.ok && closeOnSuccess) close();
    });
  }

  const trimmed = note.trim();
  const order = selected?.online_orders ?? null;
  const needsShopify = order?.source === "shopify" && !selected?.shopify_marked_manually;

  return (
    <>
      {returns.length === 0 ? <p className="admin-empty-note">{empty}</p> : <div className="returns-grid">
        {returns.map((item) => {
          const row = item.online_orders;
          const shopifyPending = canMarkShopify && row?.source === "shopify" && !item.shopify_marked_manually;
          return (
            <button key={item.id} type="button" className={`order-card ${selectedId === item.id ? "selected" : ""}`} onClick={() => open(item.id)}>
              <div className="card-top"><span className="invoice">#{row?.invoice_number ?? "Comandă"}</span>
                {row && <span className={`source-tag ${row.source}`}>{row.source === "shopify" ? "Shopify" : "Marketplace"}</span>}</div>
              <p className="card-subtitle">{row?.customer_name ?? "Client neprecizat"} · {returnReasonLabels[item.reason]}</p>
              <div className="card-bottom"><span>{formatDateTime(item.registered_at)} · {units(item)} buc.</span>
                {shopifyPending ? <span className="partner-tag important">Nemarcat în Shopify</span> : <span className="card-arrow" aria-hidden="true">›</span>}</div>
            </button>
          );
        })}
      </div>}

      {selected && <div className="detail-backdrop" onClick={close} aria-hidden="true" />}
      {selected && (
        <aside className="detail-panel" aria-label={`Detalii retur ${order?.invoice_number ?? ""}`}>
          <div className="detail-header"><div><p className="eyebrow">Factură #{order?.invoice_number ?? "—"}</p><h2>Detalii retur</h2></div><button className="close-button" aria-label="Închide detaliile" onClick={close}>×</button></div>
          <div className="detail-scroll">
            <div className="detail-meta"><span className="status-badge">{selected.status === "restocked" ? "Procesat în depozit" : "De procesat"}</span>{order && <span>{order.source === "shopify" ? "Shopify" : "Marketplace"}</span>}</div>
            {order?.bocp_order_id && <p className="detail-ref">Comandă BOCP: {order.bocp_order_id}</p>}
            <section className="detail-section"><h3>Retur</h3>
              <dl className="detail-facts">
                <dt>Motiv</dt><dd>{returnReasonLabels[selected.reason]}</dd>
                <dt>Predată</dt><dd>{formatDateTime(order?.completed_at ?? null)}</dd>
                <dt>Înregistrat</dt><dd>{formatDateTime(selected.registered_at)}</dd>
                {selected.restocked_at && <><dt>Procesat</dt><dd>{formatDateTime(selected.restocked_at)}</dd></>}
                {canMarkShopify && order?.source === "shopify" && <><dt>Shopify</dt><dd>{selected.shopify_marked_manually ? "Marcat „returned”" : "Nemarcat încă"}</dd></>}
              </dl>
            </section>
            <section className="detail-section"><h3>Client</h3><p className="detail-primary">{order?.customer_name ?? "Client neprecizat"}</p>{order?.shipping_address && <p>{order.shipping_address}</p>}{order?.customer_phone && <p>{order.customer_phone}</p>}</section>
            <section className="detail-section"><div className="section-line"><h3>Produse</h3><span>{units(selected)} {units(selected) === 1 ? "bucată" : "bucăți"}</span></div>
              <div className="item-list">{order?.online_order_items.map((line) => <div className="order-item" key={line.id}><div><strong>{line.products?.name ?? "Produs"}</strong><small>{line.products?.variant_label ? `${line.products.variant_label} · ` : ""}SKU {line.products?.sku ?? "—"}</small></div><b>×{line.quantity}</b></div>)}</div>
            </section>
            {selected.restock_note && <section className="detail-section"><h3>Nota depozitului</h3><p>{selected.restock_note}</p></section>}
            {canProcess && selected.status === "pending_restock" && <section className="detail-section"><div className="section-line"><h3>Note</h3><span>{note.length}/{noteLimit}</span></div>
              <textarea className="note-field" value={note} maxLength={noteLimit} rows={4} onChange={(event) => setNote(event.target.value)}
                placeholder="Ex. un produs lipsă, ambalaj deteriorat…" aria-label="Note despre retur" />
            </section>}
            {feedback && <p className={`action-feedback ${feedback.ok ? "success" : "error"}`} role="status" aria-live="polite">{feedback.message}</p>}
          </div>
          {((canProcess && selected.status === "pending_restock") || (canMarkShopify && needsShopify)) && <div className="detail-actions">
            {canProcess && selected.status === "pending_restock" && <div className="detail-actions-row">
              <button className="button button-primary" disabled={pending} onClick={() => run(() => confirmReturn(selected.id, trimmed || null, false), true)}>Confirm procesarea</button>
              <button className="button button-outline" disabled={pending || !trimmed} title={trimmed ? undefined : "Scrie mai întâi o notă"}
                onClick={() => run(() => confirmReturn(selected.id, trimmed, true), true)}>Procesat cu mențiuni</button>
            </div>}
            {canMarkShopify && needsShopify && <button className="button button-outline" disabled={pending} onClick={() => run(() => markReturnInShopify(selected.id), false)}>Am marcat „returned” în Shopify</button>}
          </div>}
        </aside>
      )}
    </>
  );
}
