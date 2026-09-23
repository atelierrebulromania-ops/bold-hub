import type { ReactNode } from "react";
import { formatDateTime, returnReasonLabels, statusLabels, type OrderSearchResult } from "@/lib/orders";

export function SearchForm({ action, query, placeholder }: { action: string; query: string; placeholder: string }) {
  return (
    <form action={action} method="get" className="search-form" role="search">
      <label htmlFor="order-search">Nr. factură, nr. comandă, nume, email sau telefon</label>
      <div className="admin-inline">
        <input id="order-search" name="q" defaultValue={query} minLength={3} maxLength={120} required placeholder={placeholder} autoComplete="off"/>
        <button className="button button-primary" type="submit">Caută</button>
      </div>
    </form>
  );
}

export function OrderResultCard({ order, children }: { order: OrderSearchResult; children?: ReactNode }) {
  const units = order.items.reduce((sum, item) => sum + item.quantity, 0);
  return (
    <article className="result-card">
      <div className="result-card-heading">
        <div>
          <h3>{order.invoice_number}<span className={`source-tag ${order.source}`}>{order.source === "shopify" ? "Shopify" : "Marketplace"}</span></h3>
          <p>{order.bocp_order_id ? `Comandă BOCP ${order.bocp_order_id} · ` : ""}creată {formatDateTime(order.created_at)}</p>
        </div>
        <span className={`result-status status-${order.status}`}>{statusLabels[order.status]}</span>
      </div>
      <div className="result-grid">
        <div>
          <h4>Client</h4>
          <p className="result-strong">{order.customer_name ?? "—"}</p>
          <p>{[order.customer_phone, order.customer_email].filter(Boolean).join(" · ") || "—"}</p>
          {order.shipping_address && <p>{order.shipping_address}</p>}
        </div>
        <div>
          <h4>Pregătire</h4>
          <p>Operator: <strong>{order.claimed_by_name ?? "—"}</strong></p>
          <p>Preluată: {formatDateTime(order.claimed_at)}</p>
          <p>Predată: {formatDateTime(order.completed_at)}</p>
          {order.released_at && <p>Ultima eliberare pe board: {formatDateTime(order.released_at)}</p>}
        </div>
        <div>
          <h4>Produse ({units} buc.)</h4>
          {order.items.length ? <ul className="par-list">{order.items.map((item, index) => <li key={`${item.sku}-${index}`}>
            <span>{item.name}{item.variant_label ? ` · ${item.variant_label}` : ""}<small>SKU {item.sku} · confirmate {item.scanned_quantity}/{item.quantity}</small></span>
            <strong>×{item.quantity}</strong>
          </li>)}</ul> : <p className="admin-empty-inline">Fără produse de confirmat.</p>}
        </div>
      </div>
      {order.return && <p className="result-return">
        Retur: {returnReasonLabels[order.return.reason]} · înregistrat {formatDateTime(order.return.registered_at)} · {order.return.status === "restocked" ? `verificat fizic ${formatDateTime(order.return.restocked_at)}` : "așteaptă verificarea fizică"}
      </p>}
      {children}
    </article>
  );
}
