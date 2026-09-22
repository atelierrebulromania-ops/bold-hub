"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import type { Order, OrderStatus } from "@/lib/orders";
import { claimOrder, handToCourier, markReady, releaseOrder, scanItem } from "./actions";

const columns: { status: OrderStatus; label: string; hint: string }[] = [
  { status: "pending", label: "De preluat", hint: "Așteaptă un operator" },
  { status: "claimed", label: "Preluate", hint: "Rezervate de operator" },
  { status: "preparing", label: "În pregătire", hint: "Scanare în curs" },
  { status: "ready", label: "Pregătite", hint: "Gata de predare" },
  { status: "handed_to_courier", label: "Predate", hint: "Plecat din depozit" },
];

function formatDate(value: string) {
  return new Intl.DateTimeFormat("ro-RO", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}

function itemCount(order: Order) {
  return order.online_order_items.reduce((sum, item) => sum + item.quantity, 0);
}

export function OrderBoard({ orders, userId }: { orders: Order[]; userId: string }) {
  const router = useRouter();
  const [view, setView] = useState<"all" | "mine">("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ ok: boolean; message: string } | null>(null);
  const [ean, setEan] = useState("");
  const [pending, startTransition] = useTransition();
  const scanRef = useRef<HTMLInputElement>(null);
  const selected = useMemo(() => orders.find((order) => order.id === selectedId) ?? null, [orders, selectedId]);
  const activeOrders = orders.filter((order) => order.status !== "returned");
  const visibleOrders = view === "mine" ? activeOrders.filter((order) => order.claimed_by === userId && order.status !== "handed_to_courier") : activeOrders;
  const inProgress = activeOrders.filter((order) => !["handed_to_courier"].includes(order.status)).length;
  const pendingCount = activeOrders.filter((order) => order.status === "pending").length;
  const mineCount = activeOrders.filter((order) => order.claimed_by === userId && order.status !== "handed_to_courier").length;
  const readyCount = activeOrders.filter((order) => order.status === "ready").length;
  const mine = selected?.claimed_by === userId;
  const scanned = selected?.online_order_items.reduce((sum, item) => sum + item.scanned_quantity, 0) ?? 0;
  const total = selected ? itemCount(selected) : 0;

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
    if (!selected || !ean.trim()) return;
    const code = ean;
    setEan("");
    run(() => scanItem(selected.id, code));
  }

  return (
    <div className="workspace">
      <div className="board-area">
        <div className="stat-grid" aria-label="Rezumat comenzi">
          <div className="stat-card"><span className="stat-icon blue">◫</span><div><p>Comenzi în lucru</p><strong>{inProgress}</strong><small>În fluxul depozitului</small></div></div>
          <div className="stat-card"><span className="stat-icon orange">◷</span><div><p>De preluat</p><strong>{pendingCount}</strong><small>Așteaptă un operator</small></div></div>
          <div className="stat-card"><span className="stat-icon purple">◎</span><div><p>Comenzile mele</p><strong>{mineCount}</strong><small>Preluate de tine</small></div></div>
          <div className="stat-card"><span className="stat-icon green">✓</span><div><p>Pregătite</p><strong>{readyCount}</strong><small>Gata de predare</small></div></div>
        </div>
        <section className="board-panel" aria-labelledby="board-title">
          <div className="board-panel-heading"><div><h2 id="board-title">Fluxul comenzilor</h2><p>Urmărește fiecare comandă de la preluare până la predare.</p></div><button className="refresh-button" type="button" onClick={() => router.refresh()} aria-label="Reîncarcă comenzile"><span aria-hidden="true">↻</span> Actualizează</button></div>
          <div className="board-tabs" role="group" aria-label="Filtrează comenzile">
            <button type="button" className={view === "all" ? "active" : ""} aria-pressed={view === "all"} onClick={() => setView("all")}>Toate comenzile <span>{activeOrders.length}</span></button>
            <button type="button" className={view === "mine" ? "active" : ""} aria-pressed={view === "mine"} onClick={() => setView("mine")}>Comenzile mele <span>{mineCount}</span></button>
          </div>
          {visibleOrders.length ? <div className="board" aria-label="Board comenzi online">
            {columns.map((column) => {
              const cards = visibleOrders.filter((order) => order.status === column.status);
              return (
                <section className="board-column" key={column.status}>
                  <div className="column-heading"><div><h3>{column.label}</h3><p>{column.hint}</p></div><span className="count-pill">{cards.length}</span></div>
                  <div className="column-cards">
                    {cards.length ? cards.map((order) => (
                      <button key={order.id} className={`order-card ${selectedId === order.id ? "selected" : ""}`} onClick={() => { setSelectedId(order.id); setFeedback(null); setEan(""); }} aria-label={`Deschide comanda cu factura ${order.invoice_number}`}>
                        <div className="card-top"><span className="invoice">#{order.invoice_number}</span><span className={`source-tag ${order.source}`}>{order.source === "shopify" ? "Shopify" : "Marketplace"}</span></div>
                        <p className="card-subtitle">{itemCount(order)} {itemCount(order) === 1 ? "produs" : "produse"} · {order.online_order_items.length} {order.online_order_items.length === 1 ? "poziție" : "poziții"}</p>
                        <div className="card-bottom"><time dateTime={order.created_at}>{formatDate(order.created_at)}</time><span className={order.claimed_by === userId ? "mine-label" : "card-arrow"}>{order.claimed_by === userId ? "A mea" : "↗"}</span></div>
                      </button>
                    )) : <div className="column-empty">Nicio comandă</div>}
                  </div>
                </section>
              );
            })}
          </div> : <div className="board-empty"><div className="empty-icon" aria-hidden="true"><svg viewBox="0 0 64 64" fill="none"><rect x="11" y="18" width="42" height="34" rx="5" stroke="currentColor" strokeWidth="2.5"/><path d="M11 29h42M25 18v-5a3 3 0 0 1 3-3h8a3 3 0 0 1 3 3v5M25 39h14" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"/></svg></div><h3>{view === "mine" ? "Nu ai comenzi preluate" : "Nicio comandă de procesat"}</h3><p>{view === "mine" ? "Comenzile pe care le preiei vor apărea aici." : "După configurarea sincronizării, comenzile noi vor apărea aici."}</p></div>}
        </section>
      </div>

      {selected && <div className="detail-backdrop" onClick={() => setSelectedId(null)} aria-hidden="true" />}
      {selected && (
        <aside className="detail-panel" aria-label={`Detalii comandă ${selected.invoice_number}`}>
          <div className="detail-header"><div><p className="eyebrow">Factură #{selected.invoice_number}</p><h2>Detalii comandă</h2></div><button className="close-button" aria-label="Închide detaliile" onClick={() => setSelectedId(null)}>×</button></div>
          <div className="detail-scroll">
            <div className="detail-meta"><span className="status-badge">{columns.find((c) => c.status === selected.status)?.label ?? selected.status}</span><span>{selected.source === "shopify" ? "Shopify" : "Marketplace"} · {formatDate(selected.created_at)}</span></div>
            {selected.bocp_order_id && <p className="detail-ref">Comandă BOCP: {selected.bocp_order_id}</p>}
            <section className="detail-section"><h3>Client și livrare</h3><p className="detail-primary">{selected.customer_name ?? "Client neprecizat"}</p>{selected.shipping_address && <p>{selected.shipping_address}</p>}{selected.customer_phone && <p>{selected.customer_phone}</p>}{selected.customer_email && <p>{selected.customer_email}</p>}</section>
            <section className="detail-section"><div className="section-line"><h3>Produse</h3><span>{scanned}/{total} scanate</span></div><div className="progress-track"><div style={{ width: `${total ? (scanned / total) * 100 : 0}%` }} /></div>
              {selected.online_order_items.length ? <div className="item-list">{selected.online_order_items.map((item) => <div className="order-item" key={item.id}><span className={`item-check ${item.scanned_quantity === item.quantity ? "complete" : ""}`}>{item.scanned_quantity === item.quantity ? "✓" : "·"}</span><div><strong>{item.products?.name ?? "Produs"}</strong><small>{item.products?.variant_label ?? item.products?.sku ?? ""} · EAN {item.ean}</small></div><b>{item.scanned_quantity}/{item.quantity}</b></div>)}</div> : <p className="muted">Produsele vor apărea după sincronizarea cu BOCP.</p>}
            </section>
            {mine && ["claimed", "preparing"].includes(selected.status) && <section className="detail-section scan-section"><h3>Scanare EAN</h3><p>Scanează eticheta produsului. Scannerul Zebra sau cel USB trimite codul și Enter.</p><form onSubmit={handleScan} className="scan-form"><input ref={scanRef} value={ean} onChange={(event) => setEan(event.target.value)} aria-label="Cod EAN" placeholder="Scanează sau introdu EAN" autoComplete="off" inputMode="numeric" disabled={pending} /><button className="button button-primary" disabled={pending || !ean.trim()}>Confirmă</button></form></section>}
            {feedback && <p className={`action-feedback ${feedback.ok ? "success" : "error"}`} role="status" aria-live="polite">{feedback.message}</p>}
          </div>
          <div className="detail-actions">
            {selected.invoice_pdf_url && <a className="button button-outline" href={selected.invoice_pdf_url} target="_blank" rel="noopener noreferrer">Descarcă factura ↗</a>}
            {selected.status === "pending" && <button className="button button-primary" disabled={pending} onClick={() => run(() => claimOrder(selected.id))}>Preia comanda</button>}
            {mine && ["claimed", "preparing"].includes(selected.status) && <><button className="button button-primary" disabled={pending || total === 0 || scanned < total} onClick={() => run(() => markReady(selected.id))}>Marchează pregătită</button><button className="button button-quiet" disabled={pending} onClick={() => run(() => releaseOrder(selected.id))}>Renunță la comandă</button></>}
            {mine && selected.status === "ready" && <button className="button button-primary" disabled={pending} onClick={() => run(() => handToCourier(selected.id))}>Predată curierului / șoferului</button>}
            {!mine && selected.claimed_by && selected.status !== "handed_to_courier" && <p className="muted small">Comanda este preluată de un alt operator.</p>}
          </div>
        </aside>
      )}
    </div>
  );
}
