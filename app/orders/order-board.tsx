"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import type { Order, OrderStatus } from "@/lib/orders";
import { claimOrder, confirmItemWithoutEan, handToCourier, markReady, releaseOrder, scanItem } from "./actions";

const columns: { status: OrderStatus; label: string; hint: string }[] = [
  { status: "pending", label: "De preluat", hint: "Așteaptă un operator" },
  { status: "claimed", label: "Preluate", hint: "La un operator, în pregătire" },
  { status: "ready", label: "Pregătite", hint: "Gata de predare" },
];

function formatDate(value: string) {
  return new Intl.DateTimeFormat("ro-RO", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: "Europe/Bucharest" }).format(new Date(value));
}

// "preparing" is set by the database on the first scan; on the board it is simply a claimed order.
function boardStatus(status: OrderStatus): OrderStatus {
  return status === "preparing" ? "claimed" : status;
}

function scannedCount(order: Order) {
  return order.online_order_items.reduce((sum, item) => sum + item.scanned_quantity, 0);
}

function itemCount(order: Order) {
  return order.online_order_items.reduce((sum, item) => sum + item.quantity, 0);
}

type View = "all" | "pending" | "mine" | "ready";

const filters: { view: View; label: string; hint: string; icon: string; tone: string }[] = [
  { view: "all", label: "Comenzi în lucru", hint: "Tot fluxul depozitului", icon: "◫", tone: "blue" },
  { view: "pending", label: "De preluat", hint: "Așteaptă un operator", icon: "◷", tone: "orange" },
  { view: "mine", label: "Comenzile mele", hint: "Preluate de tine", icon: "◎", tone: "purple" },
  { view: "ready", label: "Pregătite", hint: "Gata de predare", icon: "✓", tone: "green" },
];

const viewColumns: Record<View, OrderStatus[]> = {
  all: columns.map((column) => column.status),
  pending: ["pending"],
  mine: ["claimed", "ready"],
  ready: ["ready"],
};

const emptyText: Record<View, { title: string; text: string }> = {
  all: { title: "Nicio comandă de procesat", text: "Comenzile noi importate din BOCP vor apărea aici." },
  pending: { title: "Nicio comandă de preluat", text: "Toate comenzile au fost preluate de un operator." },
  mine: { title: "Nu ai comenzi preluate", text: "Comenzile pe care le preiei vor apărea aici." },
  ready: { title: "Nicio comandă pregătită", text: "Comenzile gata de predare vor apărea aici." },
};

export function OrderBoard({ orders, userId, operatorNames }: { orders: Order[]; userId: string; operatorNames: Record<string, string> }) {
  const router = useRouter();
  const [view, setView] = useState<View>("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ ok: boolean; message: string } | null>(null);
  const [scanCode, setScanCode] = useState("");
  const [pending, startTransition] = useTransition();
  const scanRef = useRef<HTMLInputElement>(null);
  const selected = useMemo(() => orders.find((order) => order.id === selectedId) ?? null, [orders, selectedId]);
  const activeOrders = orders.filter((order) => order.status !== "returned");
  const visibleColumns = columns.filter((column) => viewColumns[view].includes(column.status));
  const visibleOrders = activeOrders.filter((order) => viewColumns[view].includes(boardStatus(order.status)) && (view !== "mine" || order.claimed_by === userId));
  const inProgress = activeOrders.filter((order) => !["handed_to_courier"].includes(order.status)).length;
  const pendingCount = activeOrders.filter((order) => order.status === "pending").length;
  const mineCount = activeOrders.filter((order) => order.claimed_by === userId && order.status !== "handed_to_courier").length;
  const readyCount = activeOrders.filter((order) => order.status === "ready").length;
  const filterCounts: Record<View, number> = { all: inProgress, pending: pendingCount, mine: mineCount, ready: readyCount };
  const mine = selected?.claimed_by === userId;
  const scanned = selected ? scannedCount(selected) : 0;
  const total = selected ? itemCount(selected) : 0;
  const scanMode = selected?.online_order_items.length && selected.online_order_items.every(item => item.scan_code_type === "ean")
    ? "ean" : selected?.online_order_items.every(item => item.scan_code_type === "sku") ? "sku" : "mixed";

  useEffect(() => {
    const supabase = createClient();
    const channel = supabase.channel("boldhub-orders")
      .on("postgres_changes", { event: "*", schema: "public", table: "online_orders" }, () => router.refresh())
      .on("postgres_changes", { event: "*", schema: "public", table: "online_order_items" }, () => router.refresh())
      .subscribe();
    const interval = window.setInterval(() => router.refresh(), 30000);
    return () => { window.clearInterval(interval); void supabase.removeChannel(channel); };
  }, [router]);

  useEffect(() => {
    if (selected && mine && ["claimed", "preparing"].includes(selected.status)) scanRef.current?.focus();
  }, [selectedId, selected?.status, mine]);

  function run(action: () => Promise<{ ok: boolean; message: string }>) {
    setFeedback(null);
    startTransition(async () => {
      const result = await action();
      setFeedback(result);
      router.refresh();
      if (result.ok) scanRef.current?.focus();
    });
  }

  function handleScan(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected || !scanCode.trim()) return;
    const code = scanCode;
    setScanCode("");
    run(() => scanItem(selected.id, code));
  }

  return (
    <div className="workspace">
      <div className="board-area">
        <section className="board-panel" aria-labelledby="board-title">
          <div className="board-panel-heading"><div><h2 id="board-title">Fluxul comenzilor</h2><p>Urmărește fiecare comandă de la preluare până la predare.</p></div><button className="refresh-button" type="button" onClick={() => router.refresh()} aria-label="Reîncarcă comenzile"><span aria-hidden="true">↻</span> Actualizează</button></div>
          <div className="filter-cards" role="group" aria-label="Filtrează comenzile">
            {filters.map((filter) => (
              <button key={filter.view} type="button" className={`filter-card ${view === filter.view ? "active" : ""}`} aria-pressed={view === filter.view} onClick={() => setView(filter.view)}>
                <span className={`stat-icon ${filter.tone}`} aria-hidden="true">{filter.icon}</span>
                <span className="filter-card-text"><span className="filter-card-label">{filter.label}</span><small>{filter.hint}</small></span>
                <strong>{filterCounts[filter.view]}</strong>
              </button>
            ))}
          </div>
          {visibleOrders.length ? <div className="board" aria-label="Board comenzi online" style={{ gridTemplateColumns: `repeat(${visibleColumns.length}, minmax(210px, 1fr))` }}>
            {visibleColumns.map((column) => {
              const cards = visibleOrders.filter((order) => boardStatus(order.status) === column.status);
              return (
                <section className="board-column" key={column.status}>
                  <div className="column-heading"><div><h3>{column.label}</h3><p>{column.hint}</p></div><span className="count-pill">{cards.length}</span></div>
                  <div className="column-cards">
                    {cards.length ? cards.map((order) => {
                      const lockedByOther = Boolean(order.claimed_by && order.claimed_by !== userId && order.status !== "handed_to_courier");
                      return (
                      <button key={order.id} className={`order-card ${selectedId === order.id ? "selected" : ""} ${lockedByOther ? "locked" : ""}`} disabled={lockedByOther} onClick={() => { setSelectedId(order.id); setFeedback(null); setScanCode(""); }} aria-label={lockedByOther ? `Comanda cu factura ${order.invoice_number} este preluată de ${operatorNames[order.claimed_by!] ?? "alt operator"}` : `Deschide comanda cu factura ${order.invoice_number}`}>
                        <div className="card-top"><span className="invoice">#{order.invoice_number}</span><span className={`source-tag ${order.source}`}>{order.source === "shopify" ? "Shopify" : "Marketplace"}</span></div>
                        <p className="card-subtitle">{itemCount(order)} {itemCount(order) === 1 ? "produs" : "produse"} · {order.online_order_items.length} {order.online_order_items.length === 1 ? "poziție" : "poziții"}{boardStatus(order.status) === "claimed" && scannedCount(order) > 0 ? ` · ${scannedCount(order)}/${itemCount(order)} scanate` : ""}</p>
                        <div className="card-bottom"><time dateTime={order.created_at}>{formatDate(order.created_at)}</time>{order.claimed_by ? <span className={`operator-label ${order.claimed_by === userId ? "mine" : ""}`} title={operatorNames[order.claimed_by] ?? "Operator"}>{lockedByOther && <span aria-hidden="true">🔒 </span>}{operatorNames[order.claimed_by] ?? "Operator"}</span> : <span className="card-arrow">↗</span>}</div>
                      </button>
                      );
                    }) : <div className="column-empty">Nicio comandă</div>}
                  </div>
                </section>
              );
            })}
          </div> : <div className="board-empty"><div className="empty-icon" aria-hidden="true"><svg viewBox="0 0 64 64" fill="none"><rect x="11" y="18" width="42" height="34" rx="5" stroke="currentColor" strokeWidth="2.5"/><path d="M11 29h42M25 18v-5a3 3 0 0 1 3-3h8a3 3 0 0 1 3 3v5M25 39h14" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"/></svg></div><h3>{emptyText[view].title}</h3><p>{emptyText[view].text}</p></div>}
        </section>
      </div>

      {selected && <div className="detail-backdrop" onClick={() => setSelectedId(null)} aria-hidden="true" />}
      {selected && (
        <aside className="detail-panel" aria-label={`Detalii comandă ${selected.invoice_number}`}>
          <div className="detail-header"><div><p className="eyebrow">Factură #{selected.invoice_number}</p><h2>Detalii comandă</h2></div><button className="close-button" aria-label="Închide detaliile" onClick={() => setSelectedId(null)}>×</button></div>
          <div className="detail-scroll">
            <div className="detail-meta"><span className="status-badge">{columns.find((c) => c.status === boardStatus(selected.status))?.label ?? selected.status}</span><span>{selected.source === "shopify" ? "Shopify" : "Marketplace"} · {formatDate(selected.created_at)}</span></div>
            {selected.bocp_order_id && <p className="detail-ref">Comandă BOCP: {selected.bocp_order_id}</p>}
            <section className="detail-section"><h3>Client și livrare</h3><p className="detail-primary">{selected.customer_name ?? "Client neprecizat"}</p>{selected.shipping_address && <p>{selected.shipping_address}</p>}{selected.customer_phone && <p>{selected.customer_phone}</p>}{selected.customer_email && <p>{selected.customer_email}</p>}</section>
            <section className="detail-section"><div className="section-line"><h3>Produse</h3><span>{scanned}/{total} scanate</span></div><div className="progress-track"><div style={{ width: `${total ? (scanned / total) * 100 : 0}%` }} /></div>
              {selected.online_order_items.length ? <div className="item-list">{selected.online_order_items.map((item) => {
                const done = item.scanned_quantity === item.quantity;
                const canTick = item.no_ean && !done && mine && ["claimed", "preparing"].includes(selected.status);
                return <div className="order-item" key={item.id}>
                  {canTick
                    ? <button type="button" className="item-check tickable" disabled={pending} aria-label={`Confirmă ${item.products?.name ?? "produsul"} fără scanare`} title="Bifează după ce ai pus produsul în colet"
                      onClick={() => run(() => confirmItemWithoutEan(selected.id, item.id))} />
                    : <span className={`item-check ${done ? "complete" : ""}`}>{done ? "✓" : "·"}</span>}
                  <div><strong>{item.products?.name ?? "Produs"}</strong>
                    <small>{item.products?.variant_label ? `${item.products.variant_label} · ` : ""}SKU {item.products?.sku ?? "—"}</small>
                    {(item.is_gift || item.no_ean) && <span className="item-flags">
                      {item.is_gift && <span className="item-flag gift" title="Produs gratuit din ofertă. Pe factură apare cu preț și cu un discount egal; se pune o singură dată.">Cadou</span>}
                      {item.no_ean && <span className="item-flag no-ean" title="Produsul nu are EAN. Nu se scanează, se bifează.">Fără EAN · se bifează</span>}
                    </span>}
                  </div>
                  <b>{item.scanned_quantity}/{item.quantity}</b>
                </div>;
              })}</div> : <p className="muted">Produsele vor apărea după sincronizarea cu BOCP.</p>}
            </section>
            {mine && ["claimed", "preparing"].includes(selected.status) && <section className="detail-section scan-section"><h3>{scanMode === "ean" ? "Scanare etichetă" : scanMode === "sku" ? "Confirmare după SKU" : "Confirmare cod produs"}</h3>{scanMode !== "ean" && <p>{scanMode === "sku" ? "Introdu SKU-ul afișat la produs și apasă Enter. Este o verificare temporară, nu scanarea fizică a produsului." : "Scanează eticheta sau, unde nu există EAN, introdu SKU-ul afișat."}</p>}<form onSubmit={handleScan} className="scan-form"><input ref={scanRef} value={scanCode} onChange={(event) => setScanCode(event.target.value)} aria-label="Cod produs" placeholder={scanMode === "ean" ? "Scanează EAN" : scanMode === "sku" ? "Introdu SKU" : "Introdu codul produsului"} autoComplete="off" inputMode={scanMode === "ean" ? "numeric" : "text"} disabled={pending} /><button className="button button-primary" disabled={pending || !scanCode.trim()}>Confirmă</button></form></section>}
            {feedback && <p className={`action-feedback ${feedback.ok ? "success" : "error"}`} role="status" aria-live="polite">{feedback.message}</p>}
            {selected.invoice_pdf_url && <a className="button button-outline invoice-button" href={selected.invoice_pdf_url} target="_blank" rel="noopener noreferrer"><svg className="button-icon" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 4v11m0 0-4.5-4.5M12 15l4.5-4.5M5 19h14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>Descarcă factura</a>}
          </div>
          <div className="detail-actions">
            {selected.status === "pending" && <button className="button button-primary" disabled={pending} onClick={() => run(() => claimOrder(selected.id))}>Preia comanda</button>}
            {mine && ["claimed", "preparing"].includes(selected.status) && <><button className="button button-primary" disabled={pending || total === 0 || scanned < total} onClick={() => run(() => markReady(selected.id))}>Marchează pregătită</button><button className="button button-quiet" disabled={pending} onClick={() => run(() => releaseOrder(selected.id))}>Renunță la comandă</button></>}
            {mine && selected.status === "ready" && <button className="button button-primary" disabled={pending} onClick={() => run(() => handToCourier(selected.id))}>Predată curierului / șoferului</button>}
            {!mine && selected.claimed_by && selected.status !== "handed_to_courier" && <p className="muted small">Comanda este preluată de {operatorNames[selected.claimed_by] ?? "un alt operator"}.</p>}
          </div>
        </aside>
      )}
    </div>
  );
}
