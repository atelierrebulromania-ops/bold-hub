"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ElapsedTimer } from "@/components/elapsed-timer";
import { formatDateTime } from "@/lib/orders";
import { addPartnerRequest, deleteDeliveryGroup, handCartsToBilling, markCartPrepared, saveDeliveryGroup } from "./actions";

type Product = { name: string; sku: string; variant_label: string | null; warehouse_stock?: { quantity_bocp_global: number } | null } | null;

export type Partner = {
  id: string;
  business_name: string;
  type: string;
  contact_phone: string;
  contact_email: string | null;
  is_important_client: boolean;
  partner_par_levels: { id: string; product_id: string; par_level_quantity: number; products: Product }[];
  partner_carts: {
    id: string;
    status: "open" | "prepared" | "pending_delivery" | "delivered";
    countdown_started_at: string | null;
    prepared_at: string | null;
    partner_cart_items: { id: string; product_id: string; quantity_needed: number; products: Product }[];
  }[];
};

export type DeliveryGroup = { id: string; name: string; partner_delivery_groups: { partner_id: string }[] };

export type CatalogProduct = { id: string; name: string; sku: string; variant_label: string | null };

type RequestDraft = { partnerId: string; partnerSearch: string; lines: { productId: string; quantity: string }[]; productSearch: string; source: "whatsapp" | "telefon" };

type GroupDraft = { id: string | null; name: string; members: string[]; search: string };

const types = [
  { value: "reseller", label: "Revânzător" },
  { value: "horeca", label: "HoReCa" },
  { value: "altul", label: "Altul" },
];
const typeLabel = (value: string) => types.find((type) => type.value === value)?.label ?? value;

function productLabel(product: Product) {
  return `${product?.name ?? "Produs"}${product?.variant_label ? ` · ${product.variant_label}` : ""}`;
}

// Shelf stock is estimated: the par level minus what still has to be prepared or is on the way.
// Once the warehouse marks a cart prepared, its products count as back on the shelf.
function summarize(partner: Partner) {
  const pending = new Map<string, number>();
  for (const cart of partner.partner_carts) {
    if (cart.status === "prepared") continue;
    for (const item of cart.partner_cart_items) pending.set(item.product_id, (pending.get(item.product_id) ?? 0) + item.quantity_needed);
  }
  const levels = partner.partner_par_levels.map((level) => {
    const onShelf = Math.max(0, level.par_level_quantity - (pending.get(level.product_id) ?? 0));
    return { ...level, onShelf, missing: level.par_level_quantity - onShelf };
  }).sort((a, b) => b.missing - a.missing || productLabel(a.products).localeCompare(productLabel(b.products)));
  const openCart = partner.partner_carts.find((cart) => cart.status === "open") ?? null;
  const prepared = partner.partner_carts.filter((cart) => cart.status === "prepared");
  const inDelivery = partner.partner_carts.filter((cart) => cart.status === "pending_delivery");
  const units = (items: { quantity_needed: number }[]) => items.reduce((sum, item) => sum + item.quantity_needed, 0);
  return {
    levels,
    openCart,
    prepared,
    inDelivery,
    openUnits: openCart ? units(openCart.partner_cart_items) : 0,
    deliveryUnits: inDelivery.reduce((sum, cart) => sum + units(cart.partner_cart_items), 0),
    // Something still has to be picked for the partner's open cart.
    needsRefill: (openCart?.partner_cart_items.length ?? 0) > 0,
  };
}

type Stage = "needs" | "prepared" | "complete";

// A priority partner waiting for products or a hand-off must go out immediately.
function isUrgent(partner: Partner, info: ReturnType<typeof summarize>) {
  return partner.is_important_client && (info.needsRefill || info.prepared.length > 0);
}

const priorityChip = <span className="priority-chip" title="Client prioritar — livrare imediată">⚡ Prioritar</span>;

const columns: { stage: Stage; label: string; hint: string }[] = [
  { stage: "needs", label: "Necesită produse", hint: "Coș de pregătit pe raftul rezervat" },
  { stage: "prepared", label: "Pregătite de livrare", hint: "Produsele sunt pe raft" },
  { stage: "complete", label: "Complete", hint: "Nimic de pregătit" },
];

function stageOf(info: ReturnType<typeof summarize>): Stage {
  if (info.needsRefill) return "needs";
  if (info.prepared.length > 0 || info.inDelivery.length > 0) return "prepared";
  return "complete";
}

export function PartnersBoard({ partners, groups, catalog }: { partners: Partner[]; groups: DeliveryGroup[]; catalog: CatalogProduct[] }) {
  const [query, setQuery] = useState("");
  const [activeTypes, setActiveTypes] = useState<string[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [view, setView] = useState<"partners" | "groups" | "products">("partners");
  const [draft, setDraft] = useState<GroupDraft | null>(null);
  const [request, setRequest] = useState<RequestDraft | null>(null);
  const [feedback, setFeedback] = useState<{ ok: boolean; message: string } | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  const summaries = useMemo(() => new Map(partners.map((partner) => [partner.id, summarize(partner)])), [partners]);

  const needle = query.trim().toLocaleLowerCase("ro");
  const visible = partners.filter((partner) =>
    (activeTypes.length === 0 || activeTypes.includes(partner.type))
    && (!needle || partner.business_name.toLocaleLowerCase("ro").includes(needle)));
  const selected = partners.find((partner) => partner.id === selectedId) ?? null;
  const summary = selected ? summaries.get(selected.id)! : null;

  useEffect(() => {
    if (!selected && !draft && !request) return;
    const close = (event: KeyboardEvent) => { if (event.key === "Escape") { setSelectedId(null); setDraft(null); setRequest(null); } };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [selected, draft, request]);

  function open(id: string) {
    setDraft(null);
    setRequest(null);
    setSelectedId(id);
    setFeedback(null);
  }

  function newRequest() {
    setSelectedId(null);
    setDraft(null);
    setFeedback(null);
    setRequest({ partnerId: "", partnerSearch: "", lines: [], productSearch: "", source: "whatsapp" });
  }

  function addLine(productId: string, quantity = 1) {
    setRequest((current) => current && !current.lines.some((line) => line.productId === productId)
      ? { ...current, lines: [...current.lines, { productId, quantity: String(quantity) }], productSearch: "" } : current);
  }

  function saveRequest() {
    if (!request) return;
    const items = request.lines.map((line) => ({ productId: line.productId, quantity: Number(line.quantity) }));
    const { partnerId, source } = request;
    setFeedback(null);
    startTransition(async () => {
      const result = await addPartnerRequest(partnerId, items, source);
      setFeedback(result);
      if (result.ok) setRequest(null);
      router.refresh();
    });
  }

  function editGroup(group: DeliveryGroup | null) {
    setSelectedId(null);
    setRequest(null);
    setFeedback(null);
    setDraft(group
      ? { id: group.id, name: group.name, members: group.partner_delivery_groups.map((member) => member.partner_id), search: "" }
      : { id: null, name: "", members: [], search: "" });
  }

  function toggleMember(partnerId: string) {
    setDraft((current) => current && ({ ...current,
      members: current.members.includes(partnerId) ? current.members.filter((id) => id !== partnerId) : [...current.members, partnerId] }));
  }

  function saveGroup() {
    if (!draft) return;
    const { id, name, members } = draft;
    setFeedback(null);
    startTransition(async () => {
      const result = await saveDeliveryGroup(id, name, members);
      setFeedback(result);
      if (result.ok) setDraft(null);
      router.refresh();
    });
  }

  function removeGroup() {
    if (!draft?.id || !window.confirm(`Ștergi grupul „${draft.name}”? Partenerii rămân, doar grupul dispare.`)) return;
    const id = draft.id;
    startTransition(async () => {
      const result = await deleteDeliveryGroup(id);
      setFeedback(result);
      if (result.ok) setDraft(null);
      router.refresh();
    });
  }

  function run(action: () => Promise<{ ok: boolean; message: string }>) {
    setFeedback(null);
    startTransition(async () => {
      const result = await action();
      setFeedback(result);
      // On success the panel closes; the confirmation shows above the board.
      if (result.ok) setSelectedId(null);
      router.refresh();
    });
  }

  function handOver(partner: Partner) {
    const cartIds = summaries.get(partner.id)!.prepared.map((cart) => cart.id);
    if (!window.confirm(`Predai la facturare produsele pentru ${partner.business_name}?`)) return;
    run(() => handCartsToBilling(cartIds));
  }

  // Bulk hand-off: every prepared partner of the group goes to billing, one notification each.
  function handOverGroup(group: DeliveryGroup, members: Partner[]) {
    const ready = members.filter((partner) => summaries.get(partner.id)!.prepared.length > 0);
    const waiting = members.filter((partner) => summaries.get(partner.id)!.needsRefill && !ready.includes(partner));
    const message = `Predai la facturare grupul „${group.name}”?\n\nPleacă: ${ready.map((partner) => partner.business_name).join(", ")}`
      + (waiting.length ? `\n\nÎncă necesită produse (rămân): ${waiting.map((partner) => partner.business_name).join(", ")}` : "");
    if (!window.confirm(message)) return;
    run(() => handCartsToBilling(ready.flatMap((partner) => summaries.get(partner.id)!.prepared.map((cart) => cart.id))));
  }

  function toggleType(value: string) {
    setActiveTypes((current) => current.includes(value) ? current.filter((type) => type !== value) : [...current, value]);
  }

  // Totals per product: what still has to be picked (open carts) and what is on the reserved shelf (prepared).
  function productTotals(status: "open" | "prepared") {
    const totals = new Map<string, { product: Product; units: number; partners: Set<string> }>();
    for (const partner of partners) {
      for (const cart of partner.partner_carts) {
        if (cart.status !== status) continue;
        for (const item of cart.partner_cart_items) {
          const row = totals.get(item.product_id) ?? { product: item.products, units: 0, partners: new Set<string>() };
          row.units += item.quantity_needed;
          row.partners.add(partner.id);
          totals.set(item.product_id, row);
        }
      }
    }
    return [...totals.entries()].map(([id, row]) => ({ id, ...row }))
      .filter((row) => !needle || `${row.product?.name ?? ""} ${row.product?.sku ?? ""}`.toLocaleLowerCase("ro").includes(needle))
      .sort((a, b) => b.units - a.units || productLabel(a.product).localeCompare(productLabel(b.product), "ro"));
  }

  function renderProducts() {
    const blocks = [
      { key: "open" as const, title: "De pregătit", hint: "Produsele cerute de partenerii care necesită refill. Stocul BOCP arată dacă ai de unde.", empty: "Nimic de pregătit." },
      { key: "prepared" as const, title: "Pe raft · pregătite de livrare", hint: "Produsele puse pe raftul rezervat, care așteaptă predarea la facturare.", empty: "Nimic pe raft." },
    ];
    return (
      <div className="product-blocks">
        {blocks.map((block) => {
          const rows = productTotals(block.key);
          const units = rows.reduce((sum, row) => sum + row.units, 0);
          return (
            <section key={block.key} className="admin-card product-block">
              <div className="admin-card-heading"><h2>{block.title} <span className="product-block-total">{units} buc.</span></h2><p>{block.hint}</p></div>
              {rows.length === 0 ? <p className="admin-empty-note">{needle ? "Niciun produs nu corespunde căutării." : block.empty}</p>
                : <ul className="admin-simple-list dashboard-list">{rows.map((row) => {
                  const bocp = row.product?.warehouse_stock?.quantity_bocp_global ?? 0;
                  return (
                    <li key={row.id}>
                      <span>{productLabel(row.product)}<small>SKU {row.product?.sku ?? "—"} · {bocp > 0 ? `BOCP ${bocp}` : "stoc BOCP nesincronizat"} · {row.partners.size} {row.partners.size === 1 ? "partener" : "parteneri"}</small></span>
                      <strong className={block.key === "open" && bocp > 0 && row.units > bocp ? "over-reserved" : undefined}>{row.units} buc.</strong>
                    </li>
                  );
                })}</ul>}
            </section>
          );
        })}
      </div>
    );
  }

  function renderGroups() {
    const byId = new Map(partners.map((partner) => [partner.id, partner]));
    const shown = groups.map((group) => ({
      group,
      members: group.partner_delivery_groups.map((member) => byId.get(member.partner_id)).filter((partner): partner is Partner => !!partner)
        .sort((a, b) => a.business_name.localeCompare(b.business_name, "ro")),
    })).map((entry) => ({ ...entry, urgent: entry.members.filter((partner) => isUrgent(partner, summaries.get(partner.id)!)) }))
      .sort((a, b) => Number(b.urgent.length > 0) - Number(a.urgent.length > 0))
      .filter(({ group, members }) => !needle || group.name.toLocaleLowerCase("ro").includes(needle)
      || members.some((partner) => partner.business_name.toLocaleLowerCase("ro").includes(needle)));
    if (groups.length === 0) return <p className="admin-empty-note">Niciun grup de livrare. Creează primul grup.</p>;
    if (shown.length === 0) return <p className="admin-empty-note">Niciun grup nu corespunde căutării.</p>;
    return (
      <div className="group-grid">
        {shown.map(({ group, members, urgent }) => {
          const stages = members.map((partner) => stageOf(summaries.get(partner.id)!));
          const ready = members.filter((partner) => summaries.get(partner.id)!.prepared.length > 0).length;
          const needs = stages.filter((stage) => stage === "needs").length;
          return (
            <article key={group.id} className={`group-card ${urgent.length ? "urgent" : ""}`}>
              <div className="group-card-heading">
                <div><h3>{group.name}</h3><p>{ready} pregătiți · {needs} necesită produse · {members.length} parteneri</p></div>
                <button type="button" className="icon-button" onClick={() => editGroup(group)} aria-label={`Editează grupul ${group.name}`} title="Editează grupul"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 20h4L19 9l-4-4L4 16z"/><path d="m13.5 6.5 4 4"/></svg></button>
              </div>
              <div className="group-progress" aria-hidden="true"><div style={{ width: `${members.length ? (ready / members.length) * 100 : 0}%` }} /></div>
              {members.length === 0 ? <p className="group-empty">Grupul nu are parteneri.</p> : <ul className="group-members">
                {members.map((partner, index) => {
                  const info = summaries.get(partner.id)!;
                  const stage = stages[index];
                  return (
                    <li key={partner.id}>
                      <button type="button" onClick={() => open(partner.id)}>
                        <span className={`stage-dot ${info.prepared.length ? "prepared" : stage}`} aria-hidden="true" />
                        <span className="group-member-name">{partner.business_name}</span>
                        {partner.is_important_client && priorityChip}
                        <small className={`stage-chip ${info.prepared.length ? "prepared" : stage}`}>{info.prepared.length ? "Pregătit" : stage === "needs" ? "Necesită produse" : "Complet"}</small>
                      </button>
                    </li>
                  );
                })}
              </ul>}
              {urgent.length > 0 && <p className="group-urgent">⚡ {urgent.map((partner) => partner.business_name).join(", ")} — livrare imediată</p>}
              <button type="button" className="button button-primary group-handover" disabled={pending || ready === 0}
                onClick={() => handOverGroup(group, members)}>Predare - Facturare · {ready} {ready === 1 ? "partener" : "parteneri"}</button>
            </article>
          );
        })}
      </div>
    );
  }

  return (
    <>
      <section className="board-panel" aria-label="Parteneri">
        <div className="panel-tabs-row">
          <h2 className="panel-tabs-title">{view === "partners" ? "Parteneri" : view === "groups" ? "Grupuri de livrare" : "Produse"}</h2>
          <div className="board-tabs panel-tabs" role="tablist" aria-label="Vedere">
            <button type="button" role="tab" aria-selected={view === "partners"} className={view === "partners" ? "active" : ""} onClick={() => setView("partners")}>Parteneri <span>{partners.length}</span></button>
            <button type="button" role="tab" aria-selected={view === "groups"} className={view === "groups" ? "active" : ""} onClick={() => setView("groups")}>Grupuri de livrare <span>{groups.length}</span></button>
            <button type="button" role="tab" aria-selected={view === "products"} className={view === "products" ? "active" : ""} onClick={() => setView("products")}>Produse</button>
          </div>
          <span aria-hidden="true" />
        </div>
        <div className="board-panel-heading partners-heading">
          {view === "partners" ? <div className="partners-heading-start">
            <button type="button" className="button button-primary request-create" onClick={newRequest}>+ Adaugă cerere</button>
            <div className="partners-filters" role="group" aria-label="Filtrează după tip">
              {types.map((type) => (
                <button key={type.value} type="button" className={`partner-filter ${type.value} ${activeTypes.includes(type.value) ? "active" : ""}`}
                  aria-pressed={activeTypes.includes(type.value)} onClick={() => toggleType(type.value)}>
                  {type.label} <span>{partners.filter((partner) => partner.type === type.value).length}</span>
                </button>
              ))}
            </div>
          </div> : view === "groups" ? <>
            <button type="button" className="button button-outline group-create" onClick={() => editGroup(null)}>+ Creează grup de livrare</button>
          </> : <span />}
          <div className="partners-heading-end">
            <label className="partners-search">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true"><circle cx="11" cy="11" r="6"/><path d="m20 20-4.2-4.2"/></svg>
              <input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={view === "partners" ? "Caută partener" : view === "groups" ? "Caută grup sau partener" : "Caută produs sau SKU"} aria-label="Caută" />
            </label>
          </div>
        </div>
        {feedback && !selected && !draft && !request && <p className={`action-feedback group-feedback ${feedback.ok ? "success" : "error"}`} role="status" aria-live="polite">{feedback.message}</p>}

        {view === "products" ? renderProducts() : view === "groups" ? renderGroups() : partners.length === 0 ? <p className="admin-empty-note">Niciun partener activ.</p>
          : <div className="board partners-board" aria-label="Board parteneri">
            {columns.map((column) => {
              const cards = visible.filter((partner) => stageOf(summaries.get(partner.id)!) === column.stage)
                .sort((a, b) => Number(isUrgent(b, summaries.get(b.id)!)) - Number(isUrgent(a, summaries.get(a.id)!))
                  || (summaries.get(a.id)!.openCart?.countdown_started_at ?? "~").localeCompare(summaries.get(b.id)!.openCart?.countdown_started_at ?? "~"));
              return (
                <section className={`board-column ${column.stage === "complete" ? "board-column-wide" : ""}`} key={column.stage}>
                  <div className="column-heading"><div><h3>{column.label}</h3><p>{column.hint}</p></div><span className="count-pill">{cards.length}</span></div>
                  <div className="column-cards">
                    {cards.length ? cards.map((partner) => {
                      const info = summaries.get(partner.id)!;
                      return (
                        <button key={partner.id} type="button" className={`partner-tile ${selectedId === partner.id ? "selected" : ""} ${info.needsRefill ? "needs-refill" : ""} ${isUrgent(partner, info) ? "urgent" : ""}`}
                          onClick={() => open(partner.id)} aria-label={`${partner.business_name}${info.needsRefill ? ", are nevoie de refill" : ""}`}>
                          <span className="partner-tile-top">
                            <strong className="partner-tile-name">{partner.business_name}</strong>
                            {info.needsRefill && <ElapsedTimer since={info.openCart!.countdown_started_at} />}
                          </span>
                          <span className="partner-tile-chips">
                            <span className="partner-tile-chip-group"><span className={`partner-kind ${partner.type}`}>{typeLabel(partner.type)}</span>{partner.is_important_client && priorityChip}</span>
                            {info.needsRefill && <span className="refill-signal" title="Are nevoie de refill">
                              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 8l8-4 8 4v8l-8 4-8-4z"/><path d="M4 8l8 4 8-4M12 12v8"/></svg>
                              {info.openUnits} buc.
                            </span>}
                          </span>
                        </button>
                      );
                    }) : <div className="column-empty">{needle || activeTypes.length ? "Niciun rezultat" : "Niciun partener"}</div>}
                  </div>
                </section>
              );
            })}
          </div>}
      </section>

      {selected && summary && <div className="detail-backdrop" onClick={() => setSelectedId(null)} aria-hidden="true" />}
      {selected && summary && (
        <aside className="detail-panel" aria-label={`Detalii ${selected.business_name}`}>
          <div className="detail-header"><div><p className="eyebrow">{typeLabel(selected.type)}</p><h2>{selected.business_name}</h2></div><button className="close-button" aria-label="Închide detaliile" onClick={() => setSelectedId(null)}>×</button></div>
          <div className="detail-scroll">
            <div className="detail-meta">
              <span className={`status-badge ${isUrgent(selected, summary) ? "urgent" : summary.needsRefill ? "refill" : "handed"}`}>{isUrgent(selected, summary) ? "Client prioritar — livrare imediată" : columns.find((column) => column.stage === stageOf(summary))!.label}</span>
              {selected.is_important_client && priorityChip}
            </div>

            <section className="detail-section"><div className="section-line"><h3>Produse pe raft</h3><span>estimat / inițial</span></div>
              {summary.levels.length === 0 ? <p>Stocul inițial nu este setat pentru acest partener.</p>
                : <div className="item-list">{summary.levels.map((level) => (
                  <div className="order-item" key={level.id}>
                    <div><strong>{productLabel(level.products)}</strong><small>SKU {level.products?.sku ?? "—"}</small></div>
                    <b className={level.missing > 0 ? "stock-short" : "stock-full"}>{level.onShelf}/{level.par_level_quantity}</b>
                  </div>
                ))}</div>}
            </section>

            <section className="detail-section"><div className="section-line"><h3>Coș</h3>{summary.openCart && <ElapsedTimer since={summary.openCart.countdown_started_at} />}</div>
              {!summary.openCart ? <p>Coșul este gol.</p>
                : <div className="item-list">{summary.openCart.partner_cart_items.map((item) => (
                  <div className="order-item" key={item.id}>
                    <div><strong>{productLabel(item.products)}</strong><small>SKU {item.products?.sku ?? "—"}</small></div>
                    <b>×{item.quantity_needed}</b>
                  </div>
                ))}</div>}
              {summary.deliveryUnits > 0 && <p className="partner-note">În livrare: {summary.deliveryUnits} buc. din {summary.inDelivery.length === 1 ? "coșul trimis" : `${summary.inDelivery.length} coșuri trimise`} spre livrare.</p>}
            </section>

            {summary.prepared.map((cart) => (
              <section className="detail-section" key={cart.id}><div className="section-line"><h3>Pregătit de livrare</h3><span>{formatDateTime(cart.prepared_at)}</span></div>
                <div className="item-list">{cart.partner_cart_items.map((item) => (
                  <div className="order-item" key={item.id}>
                    <div><strong>{productLabel(item.products)}</strong><small>SKU {item.products?.sku ?? "—"}</small></div>
                    <b className="stock-full">×{item.quantity_needed}</b>
                  </div>
                ))}</div>
              </section>
            ))}

            <section className="detail-section"><h3>Contact</h3>
              <p>{selected.contact_phone}</p>{selected.contact_email && <p>{selected.contact_email}</p>}
            </section>
            {feedback && <p className={`action-feedback ${feedback.ok ? "success" : "error"}`} role="status" aria-live="polite">{feedback.message}</p>}
          </div>
          {(summary.needsRefill || summary.prepared.length > 0) && <div className="detail-actions">
            {summary.needsRefill && <button className="button button-primary" disabled={pending} onClick={() => run(() => markCartPrepared(summary.openCart!.id))}>Produsele sunt pe raft · gata de livrare</button>}
            {summary.prepared.length > 0 && <button className={`button ${summary.needsRefill ? "button-outline" : "button-primary"}`} disabled={pending} onClick={() => handOver(selected)}>Predare - Facturare</button>}
          </div>}
        </aside>
      )}
      {draft && <div className="detail-backdrop" onClick={() => setDraft(null)} aria-hidden="true" />}
      {draft && (
        <aside className="detail-panel" aria-label={draft.id ? "Editează grupul de livrare" : "Creează grup de livrare"}>
          <div className="detail-header"><div><p className="eyebrow">Grup de livrare</p><h2>{draft.id ? "Editează grupul" : "Grup nou"}</h2></div><button className="close-button" aria-label="Închide" onClick={() => setDraft(null)}>×</button></div>
          <div className="detail-scroll">
            <label className="group-field">Nume
              <input value={draft.name} maxLength={80} autoFocus onChange={(event) => setDraft({ ...draft, name: event.target.value })} placeholder="Ex. Traseu București Nord" />
            </label>
            <section className="detail-section"><div className="section-line"><h3>Parteneri</h3><span>{draft.members.length} selectați</span></div>
              <input className="group-member-search" type="search" value={draft.search} onChange={(event) => setDraft({ ...draft, search: event.target.value })} placeholder="Caută partener" aria-label="Caută partener în listă" />
              <div className="group-member-list">
                {partners.filter((partner) => partner.business_name.toLocaleLowerCase("ro").includes(draft.search.trim().toLocaleLowerCase("ro"))).map((partner) => (
                  <label key={partner.id} className="group-member">
                    <input type="checkbox" checked={draft.members.includes(partner.id)} onChange={() => toggleMember(partner.id)} />
                    <span>{partner.business_name}</span>
                    <span className={`partner-kind ${partner.type}`}>{typeLabel(partner.type)}</span>
                  </label>
                ))}
              </div>
            </section>
            {feedback && <p className={`action-feedback ${feedback.ok ? "success" : "error"}`} role="status" aria-live="polite">{feedback.message}</p>}
          </div>
          <div className="detail-actions">
            <button className="button button-primary" disabled={pending || !draft.name.trim()} onClick={saveGroup}>{draft.id ? "Salvează modificările" : "Creează grupul"}</button>
            {draft.id && <button className="button button-quiet" disabled={pending} onClick={removeGroup}>Șterge grupul</button>}
          </div>
        </aside>
      )}
      {request && <div className="detail-backdrop" onClick={() => setRequest(null)} aria-hidden="true" />}
      {request && (() => {
        const partner = partners.find((item) => item.id === request.partnerId) ?? null;
        const byId = new Map(catalog.map((product) => [product.id, product]));
        const partnerNeedle = request.partnerSearch.trim().toLocaleLowerCase("ro");
        const productNeedle = request.productSearch.trim().toLocaleLowerCase("ro");
        const matches = productNeedle.length < 2 ? [] : catalog.filter((product) =>
          `${product.name} ${product.variant_label ?? ""} ${product.sku}`.toLocaleLowerCase("ro").includes(productNeedle)).slice(0, 8);
        const valid = !!partner && request.lines.length > 0 && request.lines.every((line) => /^\d+$/.test(line.quantity) && Number(line.quantity) >= 1);
        return (
          <aside className="detail-panel" aria-label="Adaugă cerere primită">
            <div className="detail-header"><div><p className="eyebrow">Cerere primită</p><h2>Adaugă cerere</h2></div><button className="close-button" aria-label="Închide" onClick={() => setRequest(null)}>×</button></div>
            <div className="detail-scroll">
              <section className="request-step"><h3>Partener</h3>
                {partner ? <div className="request-partner">
                  <span><strong>{partner.business_name}</strong><span className="partner-tile-chip-group"><span className={`partner-kind ${partner.type}`}>{typeLabel(partner.type)}</span>{partner.is_important_client && priorityChip}</span></span>
                  <button type="button" className="text-button" onClick={() => setRequest({ ...request, partnerId: "", lines: [] })}>Schimbă</button>
                </div> : <>
                  <input className="group-member-search" type="search" autoFocus value={request.partnerSearch} onChange={(event) => setRequest({ ...request, partnerSearch: event.target.value })} placeholder="Caută partener" aria-label="Caută partener" />
                  <div className="group-member-list request-partner-list">
                    {partners.filter((item) => !partnerNeedle || item.business_name.toLocaleLowerCase("ro").includes(partnerNeedle)).slice(0, 50).map((item) => (
                      <button key={item.id} type="button" className="request-option" onClick={() => setRequest({ ...request, partnerId: item.id, partnerSearch: "" })}>
                        <span>{item.business_name}</span><span className={`partner-kind ${item.type}`}>{typeLabel(item.type)}</span>
                      </button>
                    ))}
                    {partners.every((item) => partnerNeedle && !item.business_name.toLocaleLowerCase("ro").includes(partnerNeedle)) && <p className="request-none">Niciun partener găsit.</p>}
                  </div>
                </>}
              </section>

              {partner && <section className="detail-section"><div className="section-line"><h3>Produse</h3><span>{request.lines.length} în cerere</span></div>
                {request.lines.length > 0 && <div className="item-list request-lines">{request.lines.map((line, index) => {
                  const product = byId.get(line.productId);
                  return (
                    <div className="order-item" key={line.productId}>
                      <div><strong>{product ? productLabel(product) : "Produs"}</strong><small>SKU {product?.sku ?? "—"}</small></div>
                      <input className="request-qty" inputMode="numeric" value={line.quantity} aria-label={`Cantitate ${product?.name ?? ""}`}
                        onChange={(event) => setRequest({ ...request, lines: request.lines.map((item, i) => i === index ? { ...item, quantity: event.target.value.replace(/\D/g, "") } : item) })} />
                      <button type="button" className="text-button" aria-label="Scoate produsul" onClick={() => setRequest({ ...request, lines: request.lines.filter((_, i) => i !== index) })}>×</button>
                    </div>
                  );
                })}</div>}
                {partner.partner_par_levels.length > 0 && <div className="request-suggestions"><small>Din stocul inițial al partenerului</small>
                  <div>{partner.partner_par_levels.filter((level) => !request.lines.some((line) => line.productId === level.product_id)).map((level) => (
                    <button key={level.id} type="button" className="request-chip" onClick={() => addLine(level.product_id)}>+ {productLabel(level.products)}</button>
                  ))}</div>
                </div>}
                <input className="group-member-search" type="search" value={request.productSearch} onChange={(event) => setRequest({ ...request, productSearch: event.target.value })} placeholder="Caută alt produs după nume sau SKU" aria-label="Caută produs" />
                {matches.length > 0 && <div className="group-member-list request-options">{matches.map((product) => (
                  <button key={product.id} type="button" className="request-option" onClick={() => addLine(product.id)}>
                    <span>{productLabel(product)}</span><small>SKU {product.sku}</small>
                  </button>
                ))}</div>}
              </section>}

              {partner && <section className="detail-section"><h3>Sursă</h3>
                <div className="request-sources" role="group" aria-label="Sursa cererii">
                  {(["whatsapp", "telefon"] as const).map((source) => (
                    <button key={source} type="button" className={`partner-filter ${request.source === source ? "active reseller" : ""}`} aria-pressed={request.source === source}
                      onClick={() => setRequest({ ...request, source })}>{source === "whatsapp" ? "WhatsApp" : "Telefon"}</button>
                  ))}
                </div>
              </section>}
              {feedback && <p className={`action-feedback ${feedback.ok ? "success" : "error"}`} role="status" aria-live="polite">{feedback.message}</p>}
            </div>
            <div className="detail-actions">
              <button className="button button-primary" disabled={pending || !valid} onClick={saveRequest}>Adaugă în coș și rezervă</button>
            </div>
          </aside>
        );
      })()}
    </>
  );
}
