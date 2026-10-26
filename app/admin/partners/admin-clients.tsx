"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ClientPanel, orderStatus, productCategories, typeLabel, type AgentClient, type CatalogItem } from "@/app/account/clients-board";
import { channelRules, describeRules } from "@/lib/pricing";
import {
  deleteClientLogin, savePartnerBilling, searchBocpContacts, setClientActive, setClientAgent, setClientPassword, type BocpContactMatch,
} from "./actions";

export type Agent = { id: string; full_name: string };

type Feedback = { ok: boolean; message: string } | null;

// Admin → Clienți: every client of the company, with the same client file the agents use, plus the
// admin-only settings (agent, BOCP client, login, active).
export function AdminClientsBoard({ clients, agents, owners, catalog }: { clients: AgentClient[]; agents: Agent[]; owners: Record<string, string>; catalog: CatalogItem[] }) {
  const router = useRouter();
  const [selectedId, setSelectedId] = useState<string | "new" | null>(null);
  const [search, setSearch] = useState("");
  const [agentFilter, setAgentFilter] = useState<string>("all");
  const [showInactive, setShowInactive] = useState(false);
  const categories = useMemo(() => productCategories(catalog), [catalog]);
  const selected = selectedId && selectedId !== "new" ? clients.find((client) => client.id === selectedId) ?? null : null;
  const needle = search.trim().toLocaleLowerCase("ro");
  const shown = clients.filter((client) => (showInactive || client.active)
    && (agentFilter === "all" || (agentFilter === "none" ? !client.account_id : client.account_id === agentFilter))
    && (!needle || `${client.business_name} ${client.location_name} ${client.vat_id ?? ""} ${client.billing_name ?? ""}`.toLocaleLowerCase("ro").includes(needle)));
  const inactive = clients.filter((client) => !client.active).length;

  useEffect(() => {
    if (!selectedId) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") setSelectedId(null); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selectedId]);

  return (
    <>
      <section className="board-panel" aria-label="Clienți">
        <div className="board-panel-heading"><div><h2>Clienți</h2><p>{clients.filter((client) => client.active).length} clienți activi. Un click deschide fișa completă.</p></div>
          <button type="button" className="button button-primary" onClick={() => setSelectedId("new")}>+ Client nou</button></div>
        <div className="admin-clients-toolbar">
          <label className="partners-search">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true"><circle cx="11" cy="11" r="6"/><path d="m20 20-4.2-4.2"/></svg>
            <input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Caută client, firmă sau CUI" aria-label="Caută client" />
          </label>
          <select value={agentFilter} onChange={(event) => setAgentFilter(event.target.value)} aria-label="Agent">
            <option value="all">Toți agenții</option>
            {agents.map((agent) => <option key={agent.id} value={agent.id}>{agent.full_name}</option>)}
            <option value="none">Fără agent</option>
          </select>
          {inactive > 0 && <label className="check-line"><input type="checkbox" checked={showInactive} onChange={(event) => setShowInactive(event.target.checked)} /> Arată și inactivii ({inactive})</label>}
        </div>
        {shown.length === 0 ? <p className="admin-empty-note">{clients.length ? "Niciun client nu se potrivește." : "Nu există încă clienți. Adaugă primul client cu „+ Client nou”."}</p>
          : <div className="handed-table-wrap"><table className="handed-table">
            <thead><tr><th>Client</th><th>Agent</th><th>Descriere</th><th>Discount</th><th>Cont</th><th>Status</th></tr></thead>
            <tbody>{shown.map((client) => {
              const status = orderStatus(client);
              const points = client.partner_locations.filter((location) => location.active).length;
              return (
                <tr key={client.id} className={`handed-row ${selectedId === client.id ? "selected" : ""} ${client.active ? "" : "inactive-row"}`} onClick={() => setSelectedId(client.id)}>
                  <td><button type="button" className="row-button strong" onClick={(event) => { event.stopPropagation(); setSelectedId(client.id); }}>{client.business_name}</button>
                    <small>{client.location_name}{client.stock_mode === "per_location" && points > 1 ? ` · ${points} puncte de lucru` : ""}</small></td>
                  <td>{client.account_id ? owners[client.account_id] ?? "Utilizator șters" : <span className="item-flag no-ean nowrap">Fără agent</span>}</td>
                  <td><span className="partner-tile-chip-group">
                    <span className={`partner-kind ${client.type}`}>{typeLabel(client.type)}</span>
                    {client.is_important_client && <span className="priority-chip">⚡ Prioritar</span>}
                    {!client.vat_id && <span className="item-flag no-ean">Fără date de facturare</span>}
                    {!client.active && <span className="item-flag">Inactiv</span>}
                  </span></td>
                  <td>{describeRules(channelRules(client.partner_discounts, "resale"))}</td>
                  <td className="nowrap">{client.account_username ?? <span className="muted">Fără cont</span>}</td>
                  <td><span className={`agent-status ${status.tone}`}>{status.label}</span></td>
                </tr>
              );
            })}</tbody>
          </table></div>}
      </section>

      {selectedId && <div className="detail-backdrop" onClick={() => setSelectedId(null)} aria-hidden="true" />}
      {selectedId && <ClientPanel key={`${selectedId}-${selected?.bocp_contact_id ?? ""}`} client={selected} catalog={catalog} categories={categories}
        onClose={() => setSelectedId(null)} onSaved={(id) => { router.refresh(); if (id) setSelectedId(id); }}
        admin={selected ? <AdminSection client={selected} agents={agents} owners={owners} onSaved={() => router.refresh()} /> : null} />}
    </>
  );
}

// Admin-only part of the client file.
function AdminSection({ client, agents, owners, onSaved }: { client: AgentClient; agents: Agent[]; owners: Record<string, string>; onSaved: () => void }) {
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [pending, start] = useTransition();
  const [query, setQuery] = useState("");
  const [matches, setMatches] = useState<BocpContactMatch[] | null>(null);
  const [password, setPassword] = useState("");

  function run(action: () => Promise<{ ok: boolean; message: string }>, after?: () => void) {
    setFeedback(null);
    start(async () => {
      const result = await action();
      setFeedback(result);
      if (result.ok) { after?.(); onSaved(); }
    });
  }

  function search() {
    setFeedback(null);
    start(async () => {
      const result = await searchBocpContacts(query);
      setMatches(result.contacts);
      if (!result.ok) setFeedback({ ok: false, message: result.message ?? "Căutarea nu a reușit." });
      else if (!result.contacts.length) setFeedback({ ok: false, message: "Niciun client BOCP găsit. Clientul se creează în BOCP la prima comandă, din datele de facturare." });
    });
  }

  // Linking takes the billing data from BOCP, so orders and invoices go to that client.
  function link(contact: BocpContactMatch) {
    if (!window.confirm(`Legi ${client.business_name} de clientul BOCP „${contact.billingName}”? Datele de facturare se iau din BOCP.`)) return;
    run(() => savePartnerBilling(client.id, contact), () => setMatches(null));
  }

  function unlink() {
    run(() => savePartnerBilling(client.id, {
      bocpContactId: null, billingName: client.billing_name ?? "", vatId: client.vat_id ?? "", registrationNumber: client.registration_number ?? "",
      street: client.billing_street ?? "", city: client.billing_city ?? "", county: client.billing_county ?? "", zip: client.billing_zip ?? "",
    }));
  }

  return (
    <section className="detail-section admin-client-section"><div className="section-line"><h3>Administrare</h3><span>doar administratorul</span></div>
      <div className="admin-client-grid">
        <label>Agent
          <select value={client.account_id ?? ""} disabled={pending} onChange={(event) => run(() => setClientAgent(client.id, event.target.value || null))}>
            <option value="">Fără agent</option>
            {client.account_id && !agents.some((agent) => agent.id === client.account_id) && <option value={client.account_id} disabled>{owners[client.account_id] ?? "Utilizator șters"} (nu e agent)</option>}
            {agents.map((agent) => <option key={agent.id} value={agent.id}>{agent.full_name}</option>)}
          </select>
        </label>
        <div className="admin-client-field"><span>Client în BOCP</span>
          {client.bocp_contact_id
            ? <p>Legat de clientul BOCP <strong>#{client.bocp_contact_id}</strong> <button type="button" className="text-button" disabled={pending} onClick={unlink}>Dezleagă</button></p>
            : <div className="admin-inline admin-mini-form">
              <input value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); search(); } }}
                placeholder="Nume sau CUI din BOCP" aria-label="Caută clientul în BOCP" />
              <button type="button" className="button button-outline" disabled={pending || query.trim().length < 3} onClick={search}>Caută</button>
            </div>}
        </div>
      </div>
      {matches && matches.length > 0 && <ul className="bocp-matches">{matches.map((contact) => (
        <li key={contact.bocpContactId}><button type="button" onClick={() => link(contact)}>
          <strong>{contact.billingName}</strong><small>{[contact.vatId && `CUI ${contact.vatId}`, contact.city, contact.county, contact.pricelist && `prețuri: ${contact.pricelist}`].filter(Boolean).join(" · ") || "fără date"}</small>
        </button></li>
      ))}</ul>}

      {client.auth_user_id && <div className="admin-client-field"><span>Cont manager: <strong>{client.account_username ?? "cont vechi (email)"}</strong></span>
        <div className="admin-inline admin-mini-form">
          <input value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Parolă nouă (min. 6)" aria-label="Parolă nouă" autoComplete="new-password" />
          <button type="button" className="button button-outline" disabled={pending || password.length < 6} onClick={() => run(() => setClientPassword(client.id, password), () => setPassword(""))}>Schimbă parola</button>
          <button type="button" className="text-button danger-text" disabled={pending}
            onClick={() => { if (window.confirm(`Ștergi contul „${client.account_username}”? Clientul nu se mai poate conecta până îi faci altul.`)) run(() => deleteClientLogin(client.id)); }}>Șterge contul</button>
        </div>
      </div>}

      <div className="partner-billing-actions">
        <button type="button" className="text-button danger-text" disabled={pending}
          onClick={() => { if (window.confirm(client.active ? `Dezactivezi ${client.business_name}? Dispare din liste și nu se mai poate conecta; istoricul rămâne.` : `Reactivezi ${client.business_name}?`)) run(() => setClientActive(client.id, !client.active)); }}>
          {client.active ? "Dezactivează clientul" : "Reactivează clientul"}</button>
      </div>
      {feedback && <p className={`action-feedback ${feedback.ok ? "success" : "error"}`} role="status" aria-live="polite">{feedback.message}</p>}
    </section>
  );
}
