"use client";

import { useEffect, useMemo, useState, useTransition, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { PaymentChip } from "@/components/payment-chip";
import { formatDateTime } from "@/lib/orders";
import { channelLabel, channels, usedChannels, type Channel } from "@/lib/channels";
import { channelRules, describeRules, type DiscountRule } from "@/lib/pricing";
import {
  addClientRequest, createClientLogin, createPointLogin, deletePointLogin, lookupCompany, saveClient, saveDiscounts, saveLocation, setClientParLevel, setStockMode, suggestFromInvoices,
  type ClientInput, type InvoiceSuggestion,
} from "./actions";
import { LinkPending } from "@/components/link-pending";

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
  partner_discounts: { category: string | null; percent: number; channel: string }[];
  // Consumption orders use the resale discounts unless the client has its own consumption rules.
  own_consumption_discounts: boolean;
  // central: one stock and one order for the firm (to the main point); per_location: each point its own.
  stock_mode: "central" | "per_location";
  partner_locations: ClientLocation[];
  partner_par_levels: { product_id: string; location_id: string | null; channel: string; par_level_quantity: number; products: { name: string; sku: string } | null }[];
  partner_carts: { id: string; status: string; created_at: string; prepared_at: string | null; delivered_at: string | null;
    invoiced_at: string | null; invoice_number: string | null; bocp_invoice_id: string | null;
    invoice_due_date: string | null; invoice_rest: number | null; partner_cart_items: { quantity_needed: number }[] }[];
};

export type ClientLocation = { id: string; name: string; city: string | null; address: string | null; contact_name: string | null; contact_phone: string | null; is_main: boolean; active: boolean; account_username?: string | null };

const sortLocations = (locations: ClientLocation[]) => [...locations].sort((a, b) => Number(b.is_main) - Number(a.is_main) || a.name.localeCompare(b.name, "ro"));

export type OtherClient = { id: string; business_name: string; location_name: string; type: string; account_id: string | null; account_name: string | null; delivery_groups: string[] };
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

export type ClientsView = "mine" | "all";

export function ClientsBoard({ view, clients, directory, catalog, userId }: {
  view: ClientsView; clients: AgentClient[]; directory: OtherClient[]; catalog: CatalogItem[]; userId: string;
}) {
  const router = useRouter();
  const [selectedId, setSelectedId] = useState<string | "new" | null>(null);
  const [search, setSearch] = useState("");
  const selected = selectedId && selectedId !== "new" ? clients.find((client) => client.id === selectedId) ?? null : null;
  const needle = search.trim().toLocaleLowerCase("ro");
  const matches = (text: string) => !needle || text.toLocaleLowerCase("ro").includes(needle);
  const mine = clients.filter((client) => matches(`${client.business_name} ${client.location_name} ${client.vat_id ?? ""}`));
  const everyone = directory.filter((client) => matches(`${client.business_name} ${client.location_name} ${client.account_name ?? ""}`));
  const own = new Set(clients.map((client) => client.id));
  const categories = useMemo(() => [...new Set(catalog.map((item) => item.category).filter((value): value is string => !!value))].sort((a, b) => a.localeCompare(b, "ro")), [catalog]);

  useEffect(() => {
    if (!selectedId) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") setSelectedId(null); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selectedId]);

  return (
    <>
      <section className="board-panel" aria-label="Clienți">
        <div className="panel-tabs-row">
          <h2 className="panel-tabs-title">{view === "mine" ? "Clienții mei" : "Toți clienții"}</h2>
          <nav className="board-tabs panel-tabs" aria-label="Vedere">
            <Link href="/account" className={view === "mine" ? "active" : ""} aria-current={view === "mine" ? "page" : undefined}>Clienții mei<span>{clients.length}</span><LinkPending /></Link>
            <Link href="/account?tab=all" className={view === "all" ? "active" : ""} aria-current={view === "all" ? "page" : undefined}>Toți clienții<span>{directory.length}</span><LinkPending /></Link>
          </nav>
          <span aria-hidden="true" />
        </div>
        <div className="catalog-toolbar">
          <p>{view === "mine" ? "Un click pe client deschide fișa completă." : "Toți clienții, cu agentul fiecăruia. Ai acces complet doar la ai tăi."}</p>
          <div className="agent-heading-actions">
            <input className="group-member-search" type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder={view === "mine" ? "Caută client sau CUI" : "Caută client sau agent"} aria-label="Caută client" />
            <button type="button" className="button button-primary" onClick={() => setSelectedId("new")}>+ Client nou</button>
          </div>
        </div>

        {view === "mine" ? (mine.length === 0
          ? <p className="admin-empty-note">{clients.length ? "Niciun client nu se potrivește căutării." : "Nu ai încă clienți. Adaugă primul client cu „+ Client nou”."}</p>
          : <div className="handed-table-wrap"><table className="handed-table">
            <thead><tr><th>Client</th><th>Descriere</th><th>Discount</th><th>Status</th></tr></thead>
            <tbody>{mine.map((client) => {
              const status = orderStatus(client);
              return (
                <tr key={client.id} className={`handed-row ${selectedId === client.id ? "selected" : ""}`} onClick={() => setSelectedId(client.id)}>
                  <td><button type="button" className="row-button strong" onClick={(event) => { event.stopPropagation(); setSelectedId(client.id); }}>{client.business_name}</button><small>{client.location_name}</small></td>
                  <td><span className="partner-tile-chip-group">
                    <span className={`partner-kind ${client.type}`}>{typeLabel(client.type)}</span>
                    {client.is_important_client && <span className="priority-chip">⚡ Prioritar</span>}
                    {!client.vat_id && <span className="item-flag no-ean">Fără date de facturare</span>}
                  </span></td>
                  <td>{describeRules(channelRules(client.partner_discounts, "resale"))}</td>
                  <td><span className={`agent-status ${status.tone}`}>{status.label}</span></td>
                </tr>
              );
            })}</tbody>
          </table></div>)
          : (everyone.length === 0 ? <p className="admin-empty-note">Niciun client nu se potrivește căutării.</p>
            : <div className="handed-table-wrap"><table className="handed-table">
              <thead><tr><th>Client</th><th>Grup de livrare</th><th>Tip</th><th>Agent</th></tr></thead>
              <tbody>{everyone.map((client) => {
                const isOwn = own.has(client.id) || client.account_id === userId;
                return (
                  <tr key={client.id} className={isOwn ? "handed-row" : ""} onClick={isOwn ? () => setSelectedId(client.id) : undefined}>
                    <td className="strong">{isOwn ? <button type="button" className="row-button strong" onClick={(event) => { event.stopPropagation(); setSelectedId(client.id); }}>{client.business_name}</button> : client.business_name}</td>
                    <td>{client.delivery_groups.length ? client.delivery_groups.join(", ") : <span className="muted">Fără grup</span>}</td>
                    <td>{typeLabel(client.type)}</td>
                    <td>{isOwn ? <span className="own-chip">Tu</span> : client.account_name ?? "Nealocat"}</td>
                  </tr>
                );
              })}</tbody>
            </table></div>)}
      </section>

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
      <div className="detail-header"><div>{client && <p className="eyebrow">{typeLabel(client.type)}</p>}<h2>{client?.business_name ?? "Client nou"}</h2></div>
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

        {client && <LocationsEditor key={`loc-${client.id}`} client={client} onDone={(result) => { setFeedback(result); if (result.ok) onSaved(); }} />}
        {client && <DiscountEditor key={`d-${client.id}`} client={client} categories={categories} onDone={(result) => { setFeedback(result); if (result.ok) onSaved(); }} />}
        {client && <ParLevelEditor key={`p-${client.id}`} client={client} catalog={catalog} onDone={(result) => { setFeedback(result); if (result.ok) onSaved(); }} />}
        {client && <RequestEditor key={`r-${client.id}`} client={client} catalog={catalog} onDone={(result) => { setFeedback(result); if (result.ok) onSaved(); }} />}
        {client && <LoginEditor key={`l-${client.id}`} client={client} onDone={(result) => { setFeedback(result); if (result.ok) onSaved(); }} />}
        {feedback && <p className={`action-feedback ${feedback.ok ? "success" : "error"}`} role="status" aria-live="polite">{feedback.message}</p>}
      </div>
    </aside>
  );
}

const emptyPoint = { name: "", city: "", address: "", contactName: "", contactPhone: "", active: true };

// Points of work (delivery addresses) and how the client counts its stock.
function LocationsEditor({ client, onDone }: { client: AgentClient; onDone: (result: { ok: boolean; message: string }) => void }) {
  const [editing, setEditing] = useState<{ id: string | null } & typeof emptyPoint | null>(null);
  const [pending, start] = useTransition();
  // Point logins (per-point mode): each point can have its own account that sees only that point.
  const [login, setLogin] = useState<{ pointId: string; username: string; password: string } | null>(null);
  const points = sortLocations(client.partner_locations);
  const set = (key: keyof typeof emptyPoint, value: string | boolean) => editing && setEditing({ ...editing, [key]: value });
  const perPoint = client.stock_mode === "per_location";

  function createLogin() {
    if (!login) return;
    start(async () => {
      const result = await createPointLogin(client.id, login.pointId, login.username, login.password);
      onDone(result);
      if (result.ok) setLogin(null);
    });
  }

  function removeLogin(point: ClientLocation) {
    if (!window.confirm(`Ștergi contul „${point.account_username}” al punctului ${point.name}? Nu se mai poate conecta; îi poți face altul.`)) return;
    start(async () => onDone(await deletePointLogin(client.id, point.id)));
  }

  function save() {
    if (!editing) return;
    start(async () => {
      const result = await saveLocation(client.id, editing.id, editing);
      onDone(result);
      if (result.ok) setEditing(null);
    });
  }

  function mode(next: "central" | "per_location") {
    if (next === client.stock_mode) return;
    const text = next === "per_location"
      ? "Fiecare punct de lucru va avea stocul și comenzile lui. Stocul inițial de acum trece pe punctul principal. Continui?"
      : "O singură comandă pentru toată firma, livrată la punctul principal. Rămâne stocul inițial al punctului principal; al celorlalte puncte se șterge. Continui?";
    if (!window.confirm(text)) return;
    start(async () => onDone(await setStockMode(client.id, next)));
  }

  return (
    <section className="detail-section"><div className="section-line"><h3>Puncte de lucru</h3><span>{points.filter((point) => point.active).length} active</span></div>
      <div className="stock-mode" role="group" aria-label="Stoc și comenzi">
        <span>Stoc și comenzi:</span>
        <button type="button" className={client.stock_mode === "central" ? "active" : ""} disabled={pending} onClick={() => mode("central")}>Centralizat</button>
        <button type="button" className={client.stock_mode === "per_location" ? "active" : ""} disabled={pending} onClick={() => mode("per_location")}>Pe punct de lucru</button>
      </div>
      <p className="muted small">{client.stock_mode === "central"
        ? "Un singur stoc inițial și o singură comandă pentru firmă, livrată la punctul principal; își împart ei produsele."
        : "Fiecare punct de lucru are stocul lui inițial și comenzile lui, livrate la adresa lui. Factura rămâne una pe CUI."}</p>
      <div className="item-list">{points.map((point) => (
        <div className={`order-item ${point.active ? "" : "inactive-point"}`} key={point.id}>
          <div><strong>{point.name}{point.is_main && <span className="point-main">principal</span>}{!point.active && <span className="point-main off">inactiv</span>}</strong>
            <small>{[point.address, point.city].filter(Boolean).join(", ") || "Fără adresă"}{point.contact_name || point.contact_phone ? ` · ${[point.contact_name, point.contact_phone].filter(Boolean).join(", ")}` : ""}</small></div>
          <span className="point-actions">
            {perPoint && point.active && (point.account_username
              ? <><span className="point-login">Cont: <strong>{point.account_username}</strong></span>
                <button type="button" className="text-button" disabled={pending} onClick={() => removeLogin(point)}>Șterge contul</button></>
              : <button type="button" className="text-button" onClick={() => setLogin({ pointId: point.id, username: "", password: "" })}>Creează cont</button>)}
            <button type="button" className="text-button" onClick={() => setEditing({ id: point.id, name: point.name, city: point.city ?? "", address: point.address ?? "",
              contactName: point.contact_name ?? "", contactPhone: point.contact_phone ?? "", active: point.active })}>Editează</button>
          </span>
        </div>
      ))}</div>
      {login && <div className="point-form">
        <p className="muted small">Cont pentru <strong>{points.find((point) => point.id === login.pointId)?.name}</strong>: vede doar punctul lui (stoc, cereri, comenzi, restanțe), fără facturi.</p>
        <div className="admin-inline admin-mini-form">
          <input value={login.username} maxLength={32} autoCapitalize="none" spellCheck={false} autoFocus onChange={(event) => setLogin({ ...login, username: event.target.value })} placeholder="Username" aria-label="Username" />
          <input value={login.password} onChange={(event) => setLogin({ ...login, password: event.target.value })} placeholder="Parolă (min. 6)" aria-label="Parolă" autoComplete="new-password" />
          <button type="button" className="button button-outline" disabled={pending} onClick={() => setLogin(null)}>Renunță</button>
          <button type="button" className="button button-primary" disabled={pending || login.username.trim().length < 3 || login.password.length < 6} onClick={createLogin}>Creează cont</button>
        </div>
      </div>}
      {editing ? <div className="point-form">
        <div className="partner-billing-grid">
          <label>Nume punct<input value={editing.name} maxLength={120} autoFocus onChange={(event) => set("name", event.target.value)} placeholder="ex. Iulius Mall" /></label>
          <label>Oraș<input value={editing.city} maxLength={120} onChange={(event) => set("city", event.target.value)} /></label>
          <label>Adresă de livrare<input value={editing.address} maxLength={300} onChange={(event) => set("address", event.target.value)} /></label>
          <label>Persoană de contact<input value={editing.contactName} maxLength={120} onChange={(event) => set("contactName", event.target.value)} /></label>
          <label>Telefon<input value={editing.contactPhone} maxLength={40} onChange={(event) => set("contactPhone", event.target.value)} /></label>
        </div>
        {editing.id && !points.find((point) => point.id === editing.id)?.is_main && <label className="admin-checkbox">
          <input type="checkbox" checked={editing.active} onChange={(event) => set("active", event.target.checked)} /> Punct activ (primește comenzi)</label>}
        <div className="partner-billing-actions">
          <button type="button" className="button button-outline" disabled={pending} onClick={() => setEditing(null)}>Renunță</button>
          <button type="button" className="button button-primary" disabled={pending || !editing.name.trim()} onClick={save}>{editing.id ? "Salvează punctul" : "Adaugă punctul"}</button>
        </div>
      </div> : <button type="button" className="button button-outline" onClick={() => setEditing({ id: null, ...emptyPoint })}>+ Punct de lucru</button>}
    </section>
  );
}

function DiscountEditor({ client, categories, onDone }: { client: AgentClient; categories: string[]; onDone: (result: { ok: boolean; message: string }) => void }) {
  // The Consum tab shows for clients that order for their own consumption (or already have consumption rules).
  const consumption = client.own_consumption_discounts || client.partner_par_levels.some((level) => level.channel === "consumption");
  const [channel, setChannel] = useState<Channel>("resale");
  const [own, setOwn] = useState(client.own_consumption_discounts);
  const switcher = consumption ? <div className="point-tabs channel-switch" role="tablist" aria-label="Discount pentru">{channels.map((item) =>
    <button key={item.id} type="button" role="tab" aria-selected={item.id === channel} className={item.id === channel ? "active" : ""} onClick={() => setChannel(item.id)}>{item.label}</button>)}</div> : null;
  if (channel === "consumption" && !own) {
    return (
      <section className="detail-section"><div className="section-line"><h3>Discounturi</h3><span>consum</span></div>
        {switcher}
        <label className="check-line"><input type="checkbox" checked onChange={() => setOwn(true)} /> Aceleași discounturi ca la revânzare</label>
        <p className="muted small">Acum: {describeRules(channelRules(client.partner_discounts, "resale"))}. Debifează ca să setezi alte discounturi pentru consum.</p>
        {client.own_consumption_discounts && <div className="partner-billing-actions">
          <button type="button" className="button button-outline" onClick={() => saveSame()}>Salvează</button></div>}
      </section>
    );
  }
  function saveSame() {
    void saveDiscounts(client.id, [], "consumption", false).then(onDone);
  }
  return <DiscountRules key={channel} client={client} categories={categories} channel={channel} header={<>{switcher}
    {channel === "consumption" && <label className="check-line"><input type="checkbox" checked={false} onChange={() => setOwn(false)} /> Aceleași discounturi ca la revânzare</label>}</>} onDone={onDone} />;
}

function DiscountRules({ client, categories, channel, header, onDone }: { client: AgentClient; categories: string[]; channel: Channel; header: ReactNode; onDone: (result: { ok: boolean; message: string }) => void }) {
  const initial = channel === "consumption" && !client.own_consumption_discounts ? channelRules(client.partner_discounts, "resale") : channelRules(client.partner_discounts, channel, true);
  const [general, setGeneral] = useState(String(initial.find((rule) => rule.category === null)?.percent ?? ""));
  const [rows, setRows] = useState(initial.filter((rule) => rule.category !== null).map((rule) => ({ category: rule.category!, percent: String(rule.percent) })));
  const [pending, start] = useTransition();
  const unused = categories.filter((category) => !rows.some((row) => row.category === category));

  function save() {
    const rules: DiscountRule[] = [];
    if (general.trim()) rules.push({ category: null, percent: Number(general.replace(",", ".")) });
    for (const row of rows) if (row.percent.trim()) rules.push({ category: row.category, percent: Number(row.percent.replace(",", ".")) });
    start(async () => onDone(await saveDiscounts(client.id, rules, channel, true)));
  }

  return (
    <section className="detail-section"><div className="section-line"><h3>Discounturi</h3><span>{channel === "consumption" ? "consum · " : ""}fără perioadă de valabilitate</span></div>
      {header}
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
  const points = sortLocations(client.partner_locations.filter((location) => location.active));
  const perPoint = client.stock_mode === "per_location";
  const [pointId, setPointId] = useState<string | null>(perPoint ? points[0]?.id ?? null : null);
  // Resale (shelf for its customers) or own consumption (e.g. a hotel): each has its own initial stock.
  const [channel, setChannel] = useState<Channel>("resale");
  const levels = client.partner_par_levels.filter((level) => level.location_id === (perPoint ? pointId : null) && level.channel === channel);
  const count = (id: Channel) => client.partner_par_levels.filter((level) => level.location_id === (perPoint ? pointId : null) && level.channel === id).length;
  return <ParLevelList key={`${pointId ?? "central"}-${channel}`} client={client} catalog={catalog} levels={levels} pointId={pointId} channel={channel} onDone={onDone}
    header={<>
      <div className="point-tabs channel-switch" role="tablist" aria-label="Tip stoc">{channels.map((item) =>
        <button key={item.id} type="button" role="tab" aria-selected={item.id === channel} className={item.id === channel ? "active" : ""} onClick={() => setChannel(item.id)}>
          {item.label} ({count(item.id)})</button>)}</div>
      {perPoint && points.length > 0 ? <div className="point-tabs" role="tablist" aria-label="Punct de lucru">{points.map((point) =>
        <button key={point.id} type="button" role="tab" aria-selected={point.id === pointId} className={point.id === pointId ? "active" : ""} onClick={() => setPointId(point.id)}>{point.name}</button>)}</div> : null}
    </>} />;
}

function ParLevelList({ client, catalog, levels, pointId, channel, header, onDone }: {
  client: AgentClient; catalog: CatalogItem[]; levels: AgentClient["partner_par_levels"]; pointId: string | null; channel: Channel; header: ReactNode; onDone: (result: { ok: boolean; message: string }) => void;
}) {
  const [values, setValues] = useState<Record<string, string>>(Object.fromEntries(levels.map((level) => [level.product_id, String(level.par_level_quantity)])));
  const [added, setAdded] = useState<CatalogItem[]>([]);
  const [pending, start] = useTransition();
  // Products the client bought (BOCP invoices) that are not on its shelf yet.
  const [suggestions, setSuggestions] = useState<InvoiceSuggestion[] | null>(null);
  const [suggestMessage, setSuggestMessage] = useState<string | null>(null);
  const [searching, startSearch] = useTransition();

  function suggest() {
    setSuggestMessage(null);
    startSearch(async () => {
      const result = await suggestFromInvoices(client.id);
      setSuggestMessage(result.message);
      setSuggestions(result.items ?? null);
    });
  }

  function take(item: InvoiceSuggestion) {
    setAdded((current) => [...current, { id: item.productId, name: item.name, sku: item.sku } as CatalogItem]);
    setValues((current) => ({ ...current, [item.productId]: String(item.quantity) }));
    setSuggestions((current) => current?.filter((row) => row.productId !== item.productId) ?? null);
  }
  const rows = [
    ...levels.map((level) => ({ id: level.product_id, name: level.products?.name ?? "Produs", sku: level.products?.sku ?? "—" })),
    ...added.map((item) => ({ id: item.id, name: item.name, sku: item.sku })),
  ];

  function save(productId: string) {
    const quantity = Number(values[productId] ?? "0");
    start(async () => onDone(await setClientParLevel(client.id, productId, Number.isFinite(quantity) ? Math.max(0, Math.round(quantity)) : 0, pointId, channel)));
  }

  return (
    <section className="detail-section"><div className="section-line"><h3>Stoc inițial</h3>
      <span>{client.stock_mode === "per_location" ? "pe punct de lucru · " : "centralizat · "}{channelLabel(channel).toLowerCase()} · {levels.length} produse</span></div>
      {header}
      <div className="item-list">{rows.map((row) => (
        <div className="order-item" key={row.id}>
          <div><strong>{row.name}</strong><small>SKU {row.sku}</small></div>
          <input className="request-qty" inputMode="numeric" value={values[row.id] ?? ""} onChange={(event) => setValues({ ...values, [row.id]: event.target.value.replace(/\D/g, "") })} aria-label={`Stoc inițial ${row.name}`} />
          <button type="button" className="text-button" disabled={pending} onClick={() => save(row.id)}>Salvează</button>
        </div>
      ))}</div>
      <ProductPicker catalog={catalog} exclude={new Set(rows.map((row) => row.id))} onPick={(item) => setAdded([...added, item])} placeholder="Adaugă produs în stocul inițial (nume sau SKU)" />
      <div className="invoice-suggest">
        <button type="button" className="button button-outline" disabled={searching} onClick={suggest}>{searching ? "Caut în facturile BOCP (~30 sec.)…" : "Propune din facturi BOCP"}</button>
        {suggestMessage && <span className="muted small">{suggestMessage}</span>}
      </div>
      {suggestions && suggestions.length > 0 && <div className="item-list suggestion-list">{suggestions.map((item) => (
        <div className="order-item" key={item.productId}>
          <div><strong>{item.name}</strong><small>SKU {item.sku} · pe {item.invoices} {item.invoices === 1 ? "factură" : "facturi"}, ultima {item.lastDate} · ~{item.quantity} buc./factură</small></div>
          <button type="button" className="text-button" onClick={() => take(item)}>Adaugă</button>
        </div>
      ))}</div>}
      <p className="muted small">{channel === "consumption" ? "Consum: produsele pe care clientul le folosește el (ex. hotel). Dacă are stoc doar pe Revânzare, nu vede tab-urile. " : ""}0 scoate produsul din stocul inițial. Produsele adăugate se salvează cu „Salvează” pe rândul lor.</p>
    </section>
  );
}

function RequestEditor({ client, catalog, onDone }: { client: AgentClient; catalog: CatalogItem[]; onDone: (result: { ok: boolean; message: string }) => void }) {
  const points = sortLocations(client.partner_locations.filter((location) => location.active));
  const choosePoint = client.stock_mode === "per_location" && points.length > 1;
  const [pointId, setPointId] = useState<string | null>(points[0]?.id ?? null);
  const clientChannels = usedChannels(client.partner_par_levels);
  const [channel, setChannel] = useState<Channel>(clientChannels[0] ?? "resale");
  const [lines, setLines] = useState<{ item: CatalogItem; quantity: string }[]>([]);
  const [source, setSource] = useState<"whatsapp" | "telefon">("telefon");
  const [pending, start] = useTransition();
  const byId = new Map(catalog.map((item) => [item.id, item]));
  const suggestions = client.partner_par_levels.filter((level) => level.location_id === (client.stock_mode === "per_location" ? pointId : null) && level.channel === channel).filter((level) => !lines.some((line) => line.item.id === level.product_id)).map((level) => byId.get(level.product_id)).filter((item): item is CatalogItem => !!item);
  const valid = lines.length > 0 && lines.every((line) => /^\d+$/.test(line.quantity) && Number(line.quantity) > 0);

  function send() {
    start(async () => {
      const result = await addClientRequest(client.id, lines.map((line) => ({ productId: line.item.id, quantity: Number(line.quantity) })), source, choosePoint ? pointId : null, channel);
      onDone(result);
      if (result.ok) setLines([]);
    });
  }

  return (
    <section className="detail-section"><div className="section-line"><h3>Cerere nouă</h3><span>ajunge la depozit</span></div>
      {choosePoint && <label className="point-select">Pentru punctul de lucru<select value={pointId ?? ""} onChange={(event) => setPointId(event.target.value)}>
        {points.map((point) => <option key={point.id} value={point.id}>{point.name}{point.city ? ` · ${point.city}` : ""}</option>)}</select></label>}
      {clientChannels.length > 1 && <div className="point-tabs channel-switch" role="tablist" aria-label="Tip comandă">{clientChannels.map((id) =>
        <button key={id} type="button" role="tab" aria-selected={id === channel} className={id === channel ? "active" : ""} onClick={() => setChannel(id)}>{channelLabel(id)}</button>)}</div>}
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
    <section className="detail-section"><h3>{client.stock_mode === "per_location" ? "Cont manager" : "Cont în aplicație"}</h3>
      {client.stock_mode === "per_location" && <p className="muted small">Vede toate punctele de lucru și facturile. Conturile pe punct se fac la Puncte de lucru.</p>}
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
          <PaymentChip dueDate={cart.invoice_due_date} rest={cart.invoice_rest} />
          <a className="text-button" href={`/billing/invoice/${cart.id}`} target="_blank" rel="noopener noreferrer">Descarcă</a></div>
      ))}</div>
    </section>
  );
}
