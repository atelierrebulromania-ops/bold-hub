"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { formatDateTime } from "@/lib/orders";
import { describeRules, type DiscountRule } from "@/lib/pricing";
import {
  addClientRequest, createClientLogin, lookupCompany, saveClient, saveDiscounts, setClientParLevel, type ClientInput,
} from "./actions";

export type AgentClient = {
  id: string;
  business_name: string;
  location_name: string;
  type: string;
  contact_phone: string;
  contact_email: string | null;
  is_important_client: boolean;
  active: boolean;
  auth_user_id: string | null;
  account_username: string | null;
  billing_name: string | null;
  vat_id: string | null;
  registration_number: string | null;
  billing_street: string | null;
  billing_city: string | null;
  billing_county: string | null;
  billing_zip: string | null;
  partner_discounts: { category: string | null; percent: number }[];
  partner_par_levels: { product_id: string; par_level_quantity: number; products: { name: string; sku: string } | null }[];
  partner_carts: { id: string; status: string; created_at: string; prepared_at: string | null; delivered_at: string | null;
    invoiced_at: string | null; invoice_number: string | null; bocp_invoice_id: string | null; partner_cart_items: { quantity_needed: number }[] }[];
};

export type OtherClient = { id: string; business_name: string; location_name: string; type: string; account_name: string | null };
export type CatalogItem = { id: string; name: string; sku: string; category: string | null; list_price: number | null };

type Feedback = { ok: boolean; message: string } | null;

const types = [
  { value: "reseller", label: "Revânzător" },
  { value: "horeca", label: "HoReCa" },
  { value: "altul", label: "Altul" },
] as const;
const typeLabel = (value: string) => types.find((type) => type.value === value)?.label ?? value;

const emptyClient: ClientInput = {
  businessName: "", locationName: "", contactPhone: "", contactEmail: "", type: "reseller", isImportantClient: false,
  billingName: "", vatId: "", registrationNumber: "", street: "", city: "", county: "", zip: "",
};

function toInput(client: AgentClient): ClientInput {
  return {
    businessName: client.business_name, locationName: client.location_name, contactPhone: client.contact_phone,
    contactEmail: client.contact_email ?? "", type: (types.find((type) => type.value === client.type)?.value ?? "reseller"),
    isImportantClient: client.is_important_client, billingName: client.billing_name ?? "", vatId: client.vat_id ?? "",
    registrationNumber: client.registration_number ?? "", street: client.billing_street ?? "", city: client.billing_city ?? "",
    county: client.billing_county ?? "", zip: client.billing_zip ?? "",
  };
}

// Where the client's current order is in the warehouse → billing flow.
function orderStatus(client: AgentClient) {
  const units = (cart: AgentClient["partner_carts"][number]) => cart.partner_cart_items.reduce((sum, item) => sum + item.quantity_needed, 0);
  const open = client.partner_carts.find((cart) => cart.status === "open" && cart.partner_cart_items.length > 0);
  if (open) return { tone: "needs", label: `Cerere în depozit · ${units(open)} buc.` };
  const prepared = client.partner_carts.find((cart) => cart.status === "prepared");
  if (prepared) return { tone: "prepared", label: `Pe raft, gata de livrare · ${units(prepared)} buc.` };
  const billing = client.partner_carts.find((cart) => cart.status === "delivered" && !cart.invoiced_at);
  if (billing) return { tone: "billing", label: "La facturare" };
  const last = client.partner_carts.filter((cart) => cart.invoiced_at).sort((a, b) => (b.invoiced_at ?? "").localeCompare(a.invoiced_at ?? ""))[0];
  return last ? { tone: "done", label: `Ultima factură ${last.invoice_number ?? ""} · ${formatDateTime(last.invoiced_at)}` } : { tone: "done", label: "Nicio comandă încă" };
}

export function ClientsBoard({ clients, others, catalog }: { clients: AgentClient[]; others: OtherClient[]; catalog: CatalogItem[] }) {
  const router = useRouter();
  const [selectedId, setSelectedId] = useState<string | "new" | null>(null);
  const [search, setSearch] = useState("");
  const selected = selectedId && selectedId !== "new" ? clients.find((client) => client.id === selectedId) ?? null : null;
  const needle = search.trim().toLocaleLowerCase("ro");
  const visible = clients.filter((client) => !needle || `${client.business_name} ${client.location_name} ${client.vat_id ?? ""}`.toLocaleLowerCase("ro").includes(needle));
  const categories = useMemo(() => [...new Set(catalog.map((item) => item.category).filter((value): value is string => !!value))].sort((a, b) => a.localeCompare(b, "ro")), [catalog]);

  useEffect(() => {
    if (!selectedId) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") setSelectedId(null); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selectedId]);

  return (
    <>
      <section className="board-panel" aria-label="Clienții mei">
        <div className="board-panel-heading">
          <div><h2>Clienții mei</h2><p>{clients.length} {clients.length === 1 ? "client" : "clienți"} în portofoliu.</p></div>
          <div className="agent-heading-actions">
            <input className="group-member-search" type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Caută client sau CUI" aria-label="Caută client" />
            <button type="button" className="button button-primary" onClick={() => setSelectedId("new")}>+ Client nou</button>
          </div>
        </div>
        {visible.length === 0 ? <p className="admin-empty-note">{clients.length ? "Niciun client nu se potrivește căutării." : "Nu ai încă clienți. Adaugă primul client cu „+ Client nou”."}</p>
          : <div className="returns-grid">{visible.map((client) => {
            const status = orderStatus(client);
            const rules = client.partner_discounts as DiscountRule[];
            return (
              <button key={client.id} type="button" className={`order-card ${selectedId === client.id ? "selected" : ""}`} onClick={() => setSelectedId(client.id)}>
                <div className="card-top"><span className="invoice">{client.business_name}</span></div>
                <div className="billing-card-chips">
                  <span className={`partner-kind ${client.type}`}>{typeLabel(client.type)}</span>
                  {client.is_important_client && <span className="priority-chip">⚡ Prioritar</span>}
                  {!client.vat_id && <span className="item-flag no-ean">Fără date de facturare</span>}
                </div>
                <p className="card-subtitle">{client.location_name} · {describeRules(rules)}</p>
                <div className="card-bottom"><span className={`agent-status ${status.tone}`}>{status.label}</span><span className="card-arrow" aria-hidden="true">›</span></div>
              </button>
            );
          })}</div>}
      </section>

      {others.length > 0 && <section className="board-panel agent-others" aria-label="Clienții colegilor">
        <div className="board-panel-heading"><div><h2>Clienții colegilor</h2><p>Doar pentru informare, ca să nu lucrați doi agenți cu același client.</p></div></div>
        <div className="handed-table-wrap"><table className="handed-table">
          <thead><tr><th>Client</th><th>Locație</th><th>Tip</th><th>Agent</th></tr></thead>
          <tbody>{others.map((client) => <tr key={client.id}><td className="strong">{client.business_name}</td><td>{client.location_name}</td><td>{typeLabel(client.type)}</td><td>{client.account_name ?? "Nealocat"}</td></tr>)}</tbody>
        </table></div>
      </section>}

      {selectedId && <div className="detail-backdrop" onClick={() => setSelectedId(null)} aria-hidden="true" />}
      {selectedId && <ClientPanel key={selectedId} client={selected} catalog={catalog} categories={categories}
        onClose={() => setSelectedId(null)} onSaved={(id) => { router.refresh(); if (id) setSelectedId(id); }} />}
    </>
  );
}

function ClientPanel({ client, catalog, categories, onClose, onSaved }: {
  client: AgentClient | null; catalog: CatalogItem[]; categories: string[]; onClose: () => void; onSaved: (id?: string) => void;
}) {
  const [input, setInput] = useState<ClientInput>(client ? toInput(client) : emptyClient);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [pending, start] = useTransition();
  const set = <K extends keyof ClientInput>(key: K, value: ClientInput[K]) => setInput({ ...input, [key]: value });

  function run(action: () => Promise<{ ok: boolean; message: string; id?: string }>, afterSave?: (id?: string) => void) {
    setFeedback(null);
    start(async () => {
      const result = await action();
      setFeedback({ ok: result.ok, message: result.message });
      if (result.ok) afterSave?.(result.id);
    });
  }

  function fromAnaf() {
    run(async () => {
      const result = await lookupCompany(input.vatId);
      if (result.company) {
        const company = result.company;
        setInput((current) => ({
          ...current, vatId: company.vatId, billingName: company.name, registrationNumber: company.registrationNumber,
          street: company.street, city: company.city, county: company.county, zip: company.zip,
          businessName: current.businessName || company.name, locationName: current.locationName || company.city,
        }));
      }
      return result;
    });
  }

  const complete = !!(input.vatId.trim() && input.billingName.trim() && input.street.trim() && input.city.trim() && input.county.trim()
    && input.businessName.trim() && input.locationName.trim() && input.contactPhone.trim());

  return (
    <aside className="detail-panel wide" aria-label={client ? client.business_name : "Client nou"}>
      <div className="detail-header"><div><p className="eyebrow">{client ? typeLabel(client.type) : "Client nou"}</p><h2>{client?.business_name ?? "Client nou"}</h2></div>
        <button className="close-button" aria-label="Închide" onClick={onClose}>×</button></div>
      <div className="detail-scroll">
        {client && <p className={`agent-status ${orderStatus(client).tone} block`}>{orderStatus(client).label}</p>}
        {client && <ClientInvoices client={client} />}

        <section className="detail-section"><h3>Date firmă și facturare</h3>
          <div className="cui-lookup">
            <label>CUI <span className="required">obligatoriu</span>
              <input value={input.vatId} maxLength={20} onChange={(event) => set("vatId", event.target.value)}
                onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); fromAnaf(); } }} placeholder="ex. RO42910222" /></label>
            <button type="button" className="button button-outline" disabled={pending || input.vatId.trim().length < 2} onClick={fromAnaf}>Completează din ANAF</button>
          </div>
          <div className="partner-billing-grid">
            <label>Denumire firmă<input value={input.billingName} maxLength={200} onChange={(event) => set("billingName", event.target.value)} /></label>
            <label>Nr. Reg. Com.<input value={input.registrationNumber} maxLength={40} onChange={(event) => set("registrationNumber", event.target.value)} /></label>
            <label>Stradă și număr<input value={input.street} maxLength={200} onChange={(event) => set("street", event.target.value)} /></label>
            <label>Oraș<input value={input.city} maxLength={80} onChange={(event) => set("city", event.target.value)} /></label>
            <label>Județ<input value={input.county} maxLength={80} onChange={(event) => set("county", event.target.value)} /></label>
            <label>Cod poștal<input value={input.zip} maxLength={12} onChange={(event) => set("zip", event.target.value)} /></label>
          </div>
          <h3 className="subheading">Locație și contact</h3>
          <div className="partner-billing-grid">
            <label>Nume în aplicație<input value={input.businessName} maxLength={160} onChange={(event) => set("businessName", event.target.value)} placeholder="ex. Hotel Lipscani" /></label>
            <label>Locație<input value={input.locationName} maxLength={160} onChange={(event) => set("locationName", event.target.value)} placeholder="ex. Centru Vechi" /></label>
            <label>Telefon<input value={input.contactPhone} maxLength={30} onChange={(event) => set("contactPhone", event.target.value)} /></label>
            <label>Email<input type="email" value={input.contactEmail} maxLength={254} onChange={(event) => set("contactEmail", event.target.value)} /></label>
            <label>Tip<select value={input.type} onChange={(event) => set("type", event.target.value as ClientInput["type"])}>
              {types.map((type) => <option key={type.value} value={type.value}>{type.label}</option>)}</select></label>
          </div>
          <label className="admin-checkbox"><input type="checkbox" checked={input.isImportantClient} onChange={(event) => set("isImportantClient", event.target.checked)} /> Client prioritar — livrare imediată</label>
          <div className="partner-billing-actions">
            <button type="button" className="button button-primary" disabled={pending || !complete} title={complete ? undefined : "Completează CUI, firma, adresa, numele, locația și telefonul"}
              onClick={() => run(() => saveClient(client?.id ?? null, input), (id) => onSaved(id))}>{client ? "Salvează datele" : "Adaugă clientul"}</button>
          </div>
        </section>

        {client && <DiscountEditor key={`d-${client.id}`} client={client} categories={categories} onDone={(result) => { setFeedback(result); if (result.ok) onSaved(); }} />}
        {client && <ParLevelEditor key={`p-${client.id}`} client={client} catalog={catalog} onDone={(result) => { setFeedback(result); if (result.ok) onSaved(); }} />}
        {client && <RequestEditor key={`r-${client.id}`} client={client} catalog={catalog} onDone={(result) => { setFeedback(result); if (result.ok) onSaved(); }} />}
        {client && <LoginEditor key={`l-${client.id}`} client={client} onDone={(result) => { setFeedback(result); if (result.ok) onSaved(); }} />}
        {feedback && <p className={`action-feedback ${feedback.ok ? "success" : "error"}`} role="status" aria-live="polite">{feedback.message}</p>}
      </div>
    </aside>
  );
}

function DiscountEditor({ client, categories, onDone }: { client: AgentClient; categories: string[]; onDone: (result: { ok: boolean; message: string }) => void }) {
  const initial = client.partner_discounts as DiscountRule[];
  const [general, setGeneral] = useState(String(initial.find((rule) => rule.category === null)?.percent ?? ""));
  const [rows, setRows] = useState(initial.filter((rule) => rule.category !== null).map((rule) => ({ category: rule.category!, percent: String(rule.percent) })));
  const [pending, start] = useTransition();
  const unused = categories.filter((category) => !rows.some((row) => row.category === category));

  function save() {
    const rules: DiscountRule[] = [];
    if (general.trim()) rules.push({ category: null, percent: Number(general.replace(",", ".")) });
    for (const row of rows) if (row.percent.trim()) rules.push({ category: row.category, percent: Number(row.percent.replace(",", ".")) });
    start(async () => onDone(await saveDiscounts(client.id, rules)));
  }

  return (
    <section className="detail-section"><div className="section-line"><h3>Discounturi</h3><span>fără perioadă de valabilitate</span></div>
      <div className="discount-rows">
        <label className="discount-row"><span>Toate produsele</span><span className="percent-input"><input inputMode="decimal" value={general} onChange={(event) => setGeneral(event.target.value)} placeholder="0" />%</span></label>
        {rows.map((row, index) => (
          <div className="discount-row" key={row.category}>
            <span>{row.category}</span>
            <span className="percent-input"><input inputMode="decimal" value={row.percent} onChange={(event) => setRows(rows.map((item, i) => i === index ? { ...item, percent: event.target.value } : item))} />%</span>
            <button type="button" className="remove-button" title="Scoate" aria-label={`Șterge regula ${row.category}`} onClick={() => setRows(rows.filter((_, i) => i !== index))}><svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M7 7l10 10M17 7 7 17" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"/></svg></button>
          </div>
        ))}
      </div>
      <div className="partner-billing-actions">
        {unused.length > 0 && <select value="" onChange={(event) => { if (event.target.value) setRows([...rows, { category: event.target.value, percent: "" }]); }} aria-label="Adaugă discount pe categorie">
          <option value="">+ Discount pe o categorie</option>{unused.map((category) => <option key={category} value={category}>{category}</option>)}</select>}
        <button type="button" className="button button-outline" disabled={pending} onClick={save}>Salvează discounturile</button>
      </div>
      <p className="muted small">Regula pe categorie are prioritate față de cea pe toate produsele. Facturarea vede discounturile la emiterea facturii.</p>
    </section>
  );
}

function ProductPicker({ catalog, exclude, onPick, placeholder }: { catalog: CatalogItem[]; exclude: Set<string>; onPick: (item: CatalogItem) => void; placeholder: string }) {
  const [query, setQuery] = useState("");
  const needle = query.trim().toLocaleLowerCase("ro");
  const matches = needle.length < 2 ? [] : catalog.filter((item) => !exclude.has(item.id) && `${item.name} ${item.sku}`.toLocaleLowerCase("ro").includes(needle)).slice(0, 8);
  return (
    <div className="product-picker">
      <input className="group-member-search" type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={placeholder} aria-label={placeholder} />
      {matches.length > 0 && <div className="group-member-list request-options">{matches.map((item) => (
        <button key={item.id} type="button" className="request-option" onClick={() => { onPick(item); setQuery(""); }}>
          <span>{item.name}</span><small>SKU {item.sku}{item.category ? ` · ${item.category}` : ""}</small>
        </button>
      ))}</div>}
    </div>
  );
}

function ParLevelEditor({ client, catalog, onDone }: { client: AgentClient; catalog: CatalogItem[]; onDone: (result: { ok: boolean; message: string }) => void }) {
  const [values, setValues] = useState<Record<string, string>>(Object.fromEntries(client.partner_par_levels.map((level) => [level.product_id, String(level.par_level_quantity)])));
  const [added, setAdded] = useState<CatalogItem[]>([]);
  const [pending, start] = useTransition();
  const rows = [
    ...client.partner_par_levels.map((level) => ({ id: level.product_id, name: level.products?.name ?? "Produs", sku: level.products?.sku ?? "—" })),
    ...added.map((item) => ({ id: item.id, name: item.name, sku: item.sku })),
  ];

  function save(productId: string) {
    const quantity = Number(values[productId] ?? "0");
    start(async () => onDone(await setClientParLevel(client.id, productId, Number.isFinite(quantity) ? Math.max(0, Math.round(quantity)) : 0)));
  }

  return (
    <section className="detail-section"><div className="section-line"><h3>Stoc inițial pe raftul clientului</h3><span>{client.partner_par_levels.length} produse</span></div>
      <div className="item-list">{rows.map((row) => (
        <div className="order-item" key={row.id}>
          <div><strong>{row.name}</strong><small>SKU {row.sku}</small></div>
          <input className="request-qty" inputMode="numeric" value={values[row.id] ?? ""} onChange={(event) => setValues({ ...values, [row.id]: event.target.value.replace(/\D/g, "") })} aria-label={`Stoc inițial ${row.name}`} />
          <button type="button" className="text-button" disabled={pending} onClick={() => save(row.id)}>Salvează</button>
        </div>
      ))}</div>
      <ProductPicker catalog={catalog} exclude={new Set(rows.map((row) => row.id))} onPick={(item) => setAdded([...added, item])} placeholder="Adaugă produs în stocul inițial (nume sau SKU)" />
      <p className="muted small">0 scoate produsul din stocul inițial.</p>
    </section>
  );
}

function RequestEditor({ client, catalog, onDone }: { client: AgentClient; catalog: CatalogItem[]; onDone: (result: { ok: boolean; message: string }) => void }) {
  const [lines, setLines] = useState<{ item: CatalogItem; quantity: string }[]>([]);
  const [source, setSource] = useState<"whatsapp" | "telefon">("telefon");
  const [pending, start] = useTransition();
  const byId = new Map(catalog.map((item) => [item.id, item]));
  const suggestions = client.partner_par_levels.filter((level) => !lines.some((line) => line.item.id === level.product_id)).map((level) => byId.get(level.product_id)).filter((item): item is CatalogItem => !!item);
  const valid = lines.length > 0 && lines.every((line) => /^\d+$/.test(line.quantity) && Number(line.quantity) > 0);

  function send() {
    start(async () => {
      const result = await addClientRequest(client.id, lines.map((line) => ({ productId: line.item.id, quantity: Number(line.quantity) })), source);
      onDone(result);
      if (result.ok) setLines([]);
    });
  }

  return (
    <section className="detail-section"><div className="section-line"><h3>Cerere nouă</h3><span>ajunge la depozit</span></div>
      {lines.length > 0 && <div className="item-list">{lines.map((line, index) => (
        <div className="order-item" key={line.item.id}>
          <div><strong>{line.item.name}</strong><small>SKU {line.item.sku}</small></div>
          <input className="request-qty" inputMode="numeric" value={line.quantity} onChange={(event) => setLines(lines.map((item, i) => i === index ? { ...item, quantity: event.target.value.replace(/\D/g, "") } : item))} aria-label={`Cantitate ${line.item.name}`} />
          <button type="button" className="remove-button" title="Scoate" aria-label="Scoate produsul" onClick={() => setLines(lines.filter((_, i) => i !== index))}><svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M7 7l10 10M17 7 7 17" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"/></svg></button>
        </div>
      ))}</div>}
      {suggestions.length > 0 && <div className="request-suggestions"><small>Din stocul inițial</small>
        <div>{suggestions.map((item) => <button key={item.id} type="button" className="request-chip" onClick={() => setLines([...lines, { item, quantity: "1" }])}>+ {item.name}</button>)}</div></div>}
      <ProductPicker catalog={catalog} exclude={new Set(lines.map((line) => line.item.id))} onPick={(item) => setLines([...lines, { item, quantity: "1" }])} placeholder="Alt produs (nume sau SKU)" />
      <div className="partner-billing-actions">
        <div className="request-sources" role="group" aria-label="Sursa cererii">
          {(["telefon", "whatsapp"] as const).map((value) => <button key={value} type="button" className={`partner-filter ${source === value ? "active reseller" : ""}`} aria-pressed={source === value} onClick={() => setSource(value)}>{value === "whatsapp" ? "WhatsApp" : "Telefon"}</button>)}
        </div>
        <button type="button" className="button button-primary" disabled={pending || !valid} onClick={send}>Trimite cererea la depozit</button>
      </div>
    </section>
  );
}

function LoginEditor({ client, onDone }: { client: AgentClient; onDone: (result: { ok: boolean; message: string }) => void }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [pending, start] = useTransition();
  return (
    <section className="detail-section"><h3>Cont în aplicație</h3>
      {client.auth_user_id ? <p>Clientul are cont: <strong>{client.account_username ?? "cont vechi (email)"}</strong>. Parola se schimbă din Administrare.</p>
        : <div className="admin-inline admin-mini-form">
          <input value={username} maxLength={32} autoCapitalize="none" spellCheck={false} onChange={(event) => setUsername(event.target.value)} placeholder="Username" aria-label="Username" />
          <input value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Parolă (min. 6)" aria-label="Parolă" autoComplete="new-password" />
          <button type="button" className="button button-outline" disabled={pending || username.trim().length < 3 || password.length < 6}
            onClick={() => start(async () => onDone(await createClientLogin(client.id, username, password)))}>Creează cont</button>
        </div>}
    </section>
  );
}

// The client's invoiced B2B orders, with the invoice PDF from BOCP.
function ClientInvoices({ client }: { client: AgentClient }) {
  const invoiced = client.partner_carts.filter((cart) => cart.invoiced_at && cart.bocp_invoice_id)
    .sort((a, b) => (b.invoiced_at ?? "").localeCompare(a.invoiced_at ?? "")).slice(0, 10);
  if (!invoiced.length) return null;
  return (
    <section className="detail-section"><div className="section-line"><h3>Facturi</h3><span>{invoiced.length}</span></div>
      <div className="item-list">{invoiced.map((cart) => (
        <div className="order-item" key={cart.id}><div><strong>{cart.invoice_number ?? "Factură"}</strong><small>{formatDateTime(cart.invoiced_at)}</small></div>
          <a className="text-button" href={`/billing/invoice/${cart.id}`} target="_blank" rel="noopener noreferrer">Descarcă</a></div>
      ))}</div>
    </section>
  );
}
