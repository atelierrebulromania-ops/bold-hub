"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { collectionMethods } from "@/lib/accounting/files";
import { revokeCapture, saveCompany, saveSupplier, setAccountantAccess } from "../actions";

type Supplier = { id: string; slug: string; name: string; domains: string[]; active: boolean };
type Integration = { id: string; method: string; status: string; supports_sync: boolean; last_sync_at: string | null; last_document_at: string | null;
  last_error: string | null; last_error_at: string | null; note: string | null };
export type IntegrationRow = { supplier: Supplier; integration: Integration | null; held: number; total: number };
type Company = { id: string; name: string; vat_id: string | null; active: boolean };
type Accountant = { id: string; full_name: string; username: string | null; active: boolean };
type Token = { id: string; label: string; created_at: string; expires_at: string; last_used_at: string | null };

const statusLabels: Record<string, { label: string; tone: string }> = {
  not_configured: { label: "Neconfigurat", tone: "open" },
  available: { label: "Disponibil", tone: "new" },
  connected: { label: "Conectat", tone: "paid" },
  error: { label: "Eroare", tone: "overdue" },
};
const day = (value: string | null) => value
  ? new Intl.DateTimeFormat("ro-RO", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Bucharest" }).format(new Date(value))
  : "—";

export function IntegrationsBoard({ rows, companies, accountants, access, tokens, canConnect }: {
  rows: IntegrationRow[]; companies: Company[]; accountants: Accountant[]; access: { user_id: string; company_id: string }[]; tokens: Token[]; canConnect: boolean;
}) {
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  const run = (action: () => Promise<{ ok: boolean; message: string }>) => start(async () => {
    const result = await action();
    setMessage({ ok: result.ok, text: result.message });
  });

  return (
    <div className="accounting-stack">
      {message && <p className={`notice ${message.ok ? "success" : "error"}`} role="status">{message.text}</p>}

      <section className="board-panel integrations-panel" aria-label="Surse de documente">
        <div className="board-panel-heading"><div><h2>Surse de documente</h2>
          <p>Metoda prin care ajung documentele fiecărui furnizor. „Disponibil” înseamnă că se colectează cu extensia BoldHub Capture, din contul tău deschis pe platforma lor.</p></div></div>
        <div className="handed-table-wrap"><table className="handed-table integrations-table">
          <thead><tr><th>Furnizor</th><th>Metodă</th><th>Ultimul document</th><th>Documente</th><th>Erori</th></tr></thead>
          <tbody>{rows.map(({ supplier, integration, held, total }) => {
            const status = statusLabels[integration?.status ?? "not_configured"] ?? statusLabels.not_configured;
            return (
              <tr key={supplier.id} className={supplier.active ? "" : "muted-row"}>
                <td className="strong">{supplier.name}{!supplier.active && <small>inactiv</small>}{integration?.note && <small>{integration.note}</small>}</td>
                <td data-label="Metodă"><span className="integration-method">{integration ? collectionMethods[integration.method as keyof typeof collectionMethods] ?? integration.method : "—"}</span>
                  <span className={`payment-chip ${status.tone}`}>{status.label}</span>
                  {integration?.supports_sync && <small>sincronizat {day(integration.last_sync_at)}</small>}</td>
                <td className="nowrap" data-label="Ultimul document">{day(integration?.last_document_at ?? null)}</td>
                <td className="nowrap" data-label="Documente">{held} disponibile<small>{total} în total</small></td>
                <td data-label="Erori">{integration?.last_error ? <>{integration.last_error}<small>{day(integration.last_error_at)}</small></> : <span className="muted-cell">—</span>}</td>
              </tr>
            );
          })}</tbody>
        </table></div>
      </section>

      <CaptureSection tokens={tokens} canConnect={canConnect} pending={pending} onRevoke={(id) => run(() => revokeCapture(id))} />
      <SuppliersSection rows={rows} pending={pending} onSave={(id, name, domains, active) => run(() => saveSupplier(id, name, domains, active))} />
      <CompaniesSection companies={companies} pending={pending} onSave={(id, name, vat, active) => run(() => saveCompany(id, name, vat, active))} />
      <AccessSection accountants={accountants} companies={companies.filter((company) => company.active)} access={access} pending={pending}
        onSave={(userId, ids) => run(() => setAccountantAccess(userId, ids))} />
    </div>
  );
}

function CaptureSection({ tokens, canConnect, pending, onRevoke }: { tokens: Token[]; canConnect: boolean; pending: boolean; onRevoke: (id: string) => void }) {
  return (
    <section className="board-panel" aria-label="BoldHub Capture">
      <div className="board-panel-heading"><div><h2>BoldHub Capture</h2>
        <p>Extensia Chrome care trimite facturile descărcate din conturile tale de furnizor direct în BoldHub. Nu stochează parole: primește o cheie limitată, valabilă 90 de zile, pe care o poți revoca oricând.</p></div>
        {canConnect && <Link className="button button-primary" href="/accounting/capture/connect">Conectează extensia</Link>}</div>
      {tokens.length === 0 ? <p className="admin-empty-note">Nicio extensie conectată.</p>
        : <div className="handed-table-wrap"><table className="handed-table">
          <thead><tr><th>Browser</th><th>Conectat</th><th>Ultima folosire</th><th>Expiră</th><th /></tr></thead>
          <tbody>{tokens.map((token) => <tr key={token.id}>
            <td className="strong">{token.label}</td><td className="nowrap">{day(token.created_at)}</td><td className="nowrap">{day(token.last_used_at)}</td>
            <td className="nowrap">{day(token.expires_at)}</td>
            <td className="doc-actions"><button type="button" className="text-button danger-text" disabled={pending}
              onClick={() => { if (confirm(`Deconectezi extensia „${token.label}”? Cheia ei nu va mai funcționa.`)) onRevoke(token.id); }}>Deconectează</button></td>
          </tr>)}</tbody>
        </table></div>}
      <details className="install-details">
        <summary>Cum instalezi extensia în Chrome</summary>
        <ol className="install-steps">
          <li>Copiază folderul <code>extensions/boldhub-capture</code> din proiect pe calculatorul pe care o folosești.</li>
          <li>Deschide <code>chrome://extensions</code> și pornește „Developer mode” (dreapta sus).</li>
          <li>Apasă „Load unpacked” și alege folderul <code>boldhub-capture</code>.</li>
          <li>Fixează extensia în bară (iconița puzzle → pin), apoi deschide-o și apasă „Conectează BoldHub”.</li>
          <li>În pagina BoldHub care se deschide (trebuie să fii logat ca administrator) confirmă conectarea.</li>
          <li>Pe pagina de facturare a unui furnizor (Meta, Google Ads, Shopify etc.) deschide factura sau lista de facturi și apasă iconița extensiei.</li>
        </ol>
      </details>
    </section>
  );
}

function SuppliersSection({ rows, pending, onSave }: { rows: IntegrationRow[]; pending: boolean; onSave: (id: string | null, name: string, domains: string, active: boolean) => void }) {
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState({ name: "", domains: "", active: true });
  const [fresh, setFresh] = useState({ name: "", domains: "" });
  return (
    <section className="board-panel" aria-label="Furnizori">
      <div className="board-panel-heading"><div><h2>Furnizori și domenii</h2><p>Extensia recunoaște furnizorul după domeniul paginii deschise (și subdomeniile lui).</p></div></div>
      <div className="accounting-form-row">
        <label>Furnizor nou<input value={fresh.name} maxLength={120} onChange={(event) => setFresh({ ...fresh, name: event.target.value })} placeholder="ex. Canva" /></label>
        <label className="grow">Domenii<input value={fresh.domains} onChange={(event) => setFresh({ ...fresh, domains: event.target.value })} placeholder="canva.com, www.canva.com" /></label>
        <button type="button" className="button button-outline" disabled={pending || fresh.name.trim().length < 2}
          onClick={() => { onSave(null, fresh.name, fresh.domains, true); setFresh({ name: "", domains: "" }); }}>Adaugă</button>
      </div>
      <div className="handed-table-wrap"><table className="handed-table">
        <thead><tr><th>Furnizor</th><th>Domenii</th><th>Activ</th><th /></tr></thead>
        <tbody>{rows.map(({ supplier }) => editing === supplier.id ? (
          <tr key={supplier.id}>
            <td><input className="table-input" value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} aria-label="Nume furnizor" /></td>
            <td><input className="table-input" value={draft.domains} onChange={(event) => setDraft({ ...draft, domains: event.target.value })} aria-label="Domenii" /></td>
            <td><input type="checkbox" className="table-check" checked={draft.active} onChange={(event) => setDraft({ ...draft, active: event.target.checked })} aria-label="Activ" /></td>
            <td className="doc-actions nowrap">
              <button type="button" className="text-button" onClick={() => setEditing(null)}>Renunță</button>
              <button type="button" className="text-button" disabled={pending} onClick={() => { onSave(supplier.id, draft.name, draft.domains, draft.active); setEditing(null); }}>Salvează</button>
            </td>
          </tr>
        ) : (
          <tr key={supplier.id}>
            <td className="strong">{supplier.name}</td>
            <td>{supplier.domains.length ? supplier.domains.join(", ") : <span className="muted-cell">fără domenii (doar încărcare manuală)</span>}</td>
            <td>{supplier.active ? "Da" : "Nu"}</td>
            <td className="doc-actions"><button type="button" className="text-button"
              onClick={() => { setEditing(supplier.id); setDraft({ name: supplier.name, domains: supplier.domains.join(", "), active: supplier.active }); }}>Editează</button></td>
          </tr>
        ))}</tbody>
      </table></div>
    </section>
  );
}

function CompaniesSection({ companies, pending, onSave }: { companies: Company[]; pending: boolean; onSave: (id: string | null, name: string, vat: string, active: boolean) => void }) {
  const [fresh, setFresh] = useState({ name: "", vat: "" });
  return (
    <section className="board-panel" aria-label="Companii">
      <div className="board-panel-heading"><div><h2>Companii</h2><p>Fiecare document aparține unei companii; contabilitatea vede doar companiile la care are acces.</p></div></div>
      <div className="accounting-form-row">
        <label className="grow">Companie nouă<input value={fresh.name} maxLength={160} onChange={(event) => setFresh({ ...fresh, name: event.target.value })} placeholder="Denumire S.R.L." /></label>
        <label>CUI<input value={fresh.vat} maxLength={20} onChange={(event) => setFresh({ ...fresh, vat: event.target.value })} placeholder="RO…" /></label>
        <button type="button" className="button button-outline" disabled={pending || fresh.name.trim().length < 2}
          onClick={() => { onSave(null, fresh.name, fresh.vat, true); setFresh({ name: "", vat: "" }); }}>Adaugă</button>
      </div>
      <div className="handed-table-wrap"><table className="handed-table">
        <thead><tr><th>Companie</th><th>CUI</th><th>Status</th><th /></tr></thead>
        <tbody>{companies.map((company) => <tr key={company.id}>
          <td className="strong">{company.name}</td><td>{company.vat_id ?? "—"}</td>
          <td><span className={`payment-chip ${company.active ? "paid" : "open"}`}>{company.active ? "Activă" : "Inactivă"}</span></td>
          <td className="doc-actions"><button type="button" className="text-button" disabled={pending}
            onClick={() => { if (!company.active || confirm(`Dezactivezi ${company.name}? Documentele ei nu vor mai apărea contabilității.`)) onSave(company.id, company.name, company.vat_id ?? "", !company.active); }}>{company.active ? "Dezactivează" : "Activează"}</button></td>
        </tr>)}</tbody>
      </table></div>
    </section>
  );
}

function AccessSection({ accountants, companies, access, pending, onSave }: {
  accountants: Accountant[]; companies: Company[]; access: { user_id: string; company_id: string }[]; pending: boolean; onSave: (userId: string, ids: string[]) => void;
}) {
  const [drafts, setDrafts] = useState<Record<string, string[]>>(() => Object.fromEntries(accountants.map((user) =>
    [user.id, access.filter((row) => row.user_id === user.id).map((row) => row.company_id)])));
  return (
    <section className="board-panel" aria-label="Acces contabilitate">
      <div className="board-panel-heading"><div><h2>Acces contabilitate</h2>
        <p>Conturile cu rolul „Contabilitate” (create din Administrare → Utilizatori) văd și descarcă doar documentele companiilor bifate. Nu pot încărca, modifica sau șterge.</p></div></div>
      {accountants.length === 0 ? <p className="admin-empty-note">Nu există încă niciun cont de contabilitate.</p>
        : <div className="handed-table-wrap"><table className="handed-table">
          <thead><tr><th>Cont</th><th>Companii</th><th /></tr></thead>
          <tbody>{accountants.map((user) => {
            const chosen = drafts[user.id] ?? [];
            return <tr key={user.id}>
              <td className="strong">{user.full_name}<small>{user.username ?? ""}{user.active ? "" : " · dezactivat"}</small></td>
              <td><div className="access-companies">{companies.map((company) => <label key={company.id}>
                <input type="checkbox" checked={chosen.includes(company.id)}
                  onChange={(event) => setDrafts({ ...drafts, [user.id]: event.target.checked ? [...chosen, company.id] : chosen.filter((id) => id !== company.id) })} />
                {company.name}</label>)}</div></td>
              <td className="doc-actions"><button type="button" className="text-button" disabled={pending} onClick={() => onSave(user.id, chosen)}>Salvează</button></td>
            </tr>;
          })}</tbody>
        </table></div>}
    </section>
  );
}
