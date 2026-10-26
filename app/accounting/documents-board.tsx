"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { collectionMethods, docTypeLabel, docTypes, kindFromName, kindMime, maxDocumentBytes } from "@/lib/accounting/files";
import { createClient } from "@/lib/supabase/client";
import { finishManualUpload, startManualUpload } from "./actions";

export type AccountingDocument = {
  id: string; company_id: string; supplier_id: string; doc_type: string; invoice_number: string | null; issued_on: string | null; period: string;
  original_name: string; mime_type: string; size_bytes: number; collection_method: string; collected_at: string; expires_at: string;
  last_downloaded_at: string | null; download_count: number; file_deleted_at: string | null;
  accounting_suppliers: { name: string } | null; accounting_companies: { name: string } | null;
};
type Option = { id: string; name: string };
type SupplierOption = Option & { default_doc_type: string };
type Status = "all" | "new" | "downloaded";

const day = (value: string) => new Intl.DateTimeFormat("ro-RO", { day: "2-digit", month: "short", year: "numeric", timeZone: "Europe/Bucharest" }).format(new Date(value));
const monthName = (month: string) => new Intl.DateTimeFormat("ro-RO", { month: "long" }).format(new Date(`2000-${month}-15T12:00:00`));
const size = (bytes: number) => bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
const thisMonth = () => new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Bucharest", year: "numeric", month: "2-digit" }).format(new Date());

function statusOf(document: AccountingDocument) {
  if (document.file_deleted_at) return { id: "expired", label: "Expirat" };
  return document.last_downloaded_at ? { id: "downloaded", label: "Descărcat" } : { id: "new", label: "Nou" };
}

export function DocumentsBoard({ documents, companies, suppliers, canUpload, highlight }: {
  documents: AccountingDocument[]; companies: Option[]; suppliers: SupplierOption[]; canUpload: boolean; highlight: string | null;
}) {
  const router = useRouter();
  const [company, setCompany] = useState("");
  const [supplier, setSupplier] = useState("");
  const [type, setType] = useState("");
  const [year, setYear] = useState("");
  const [month, setMonth] = useState("");
  const [status, setStatus] = useState<Status>("all");
  const [query, setQuery] = useState("");
  const [showExpired, setShowExpired] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [uploading, setUploading] = useState(false);
  const zipForm = useRef<HTMLFormElement>(null);

  const now = Date.now();
  const years = useMemo(() => [...new Set(documents.map((document) => document.period.slice(0, 4)))].sort().reverse(), [documents]);
  const needle = query.trim().toLocaleLowerCase("ro");
  const held = documents.filter((document) => !document.file_deleted_at);
  const shown = (showExpired ? documents.filter((document) => document.file_deleted_at) : held).filter((document) =>
    (!company || document.company_id === company) && (!supplier || document.supplier_id === supplier) && (!type || document.doc_type === type)
    && (!year || document.period.startsWith(year)) && (!month || document.period.endsWith(`-${month}`))
    && (showExpired || status === "all" || statusOf(document).id === status)
    && (!needle || `${document.original_name} ${document.invoice_number ?? ""}`.toLocaleLowerCase("ro").includes(needle)));
  const selectable = shown.filter((document) => !document.file_deleted_at);
  const allSelected = selectable.length > 0 && selectable.every((document) => selected.has(document.id));
  const counts = { all: held.length, new: held.filter((document) => !document.last_downloaded_at).length, downloaded: held.filter((document) => document.last_downloaded_at).length };

  useEffect(() => {
    if (!highlight) return;
    document.getElementById(`doc-${highlight}`)?.scrollIntoView({ block: "center" });
  }, [highlight]);

  function toggle(id: string) {
    setSelected((current) => { const next = new Set(current); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  }

  // The ZIP downloads through a normal form post (the browser saves it); the list then refreshes its statuses.
  function downloadZip() {
    zipForm.current?.submit();
    setTimeout(() => { setSelected(new Set()); router.refresh(); }, 2500);
  }

  return (
    <section className="board-panel accounting-panel" aria-label="Documente">
      <div className="board-panel-heading">
        <div><h2>Documente</h2><p>{counts.all} disponibile · {counts.new} noi · se șterg automat la 30 de zile de la colectare.</p></div>
        {canUpload && <button type="button" className="button button-primary" onClick={() => setUploading(!uploading)}>{uploading ? "Închide încărcarea" : "+ Încarcă documente"}</button>}
      </div>
      {canUpload && uploading && <UploadPanel companies={companies} suppliers={suppliers} onDone={() => router.refresh()} />}
      {companies.length === 0 && <p className="notice error accounting-note">Nu ai acces la nicio companie. Administratorul îți dă acces din Contabilitate → Integrări.</p>}

      <div className="accounting-filters">
        <label className="partners-search">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true"><circle cx="11" cy="11" r="6"/><path d="m20 20-4.2-4.2"/></svg>
          <input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Caută după nume sau nr. factură" aria-label="Caută document" />
        </label>
        {companies.length > 1 && <select value={company} onChange={(event) => setCompany(event.target.value)} aria-label="Companie"><option value="">Toate companiile</option>{companies.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select>}
        <select value={supplier} onChange={(event) => setSupplier(event.target.value)} aria-label="Furnizor"><option value="">Toți furnizorii</option>{suppliers.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select>
        <select value={type} onChange={(event) => setType(event.target.value)} aria-label="Tip document"><option value="">Toate tipurile</option>{docTypes.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select>
        <select value={year} onChange={(event) => setYear(event.target.value)} aria-label="An"><option value="">Toți anii</option>{years.map((item) => <option key={item} value={item}>{item}</option>)}</select>
        <select value={month} onChange={(event) => setMonth(event.target.value)} aria-label="Lună"><option value="">Toate lunile</option>
          {Array.from({ length: 12 }, (_, index) => String(index + 1).padStart(2, "0")).map((item) => <option key={item} value={item}>{monthName(item)}</option>)}</select>
      </div>
      <div className="accounting-toolbar">
        {!showExpired && <div className="board-tabs accounting-tabs" role="group" aria-label="Status">
          {(["all", "new", "downloaded"] as const).map((id) => <button key={id} type="button" className={status === id ? "active" : ""} aria-pressed={status === id} onClick={() => setStatus(id)}>
            {id === "all" ? "Toate" : id === "new" ? "Noi" : "Descărcate"} <span>{counts[id]}</span></button>)}</div>}
        <label className="accounting-check"><input type="checkbox" checked={showExpired} onChange={(event) => { setShowExpired(event.target.checked); setSelected(new Set()); }} /> Istoric expirate</label>
        {selected.size > 0 && <button type="button" className="button button-primary" onClick={downloadZip}>Descarcă ZIP ({selected.size})</button>}
      </div>
      <form ref={zipForm} method="post" action="/accounting/zip" hidden>{[...selected].map((id) => <input key={id} type="hidden" name="id" value={id} />)}</form>

      {shown.length === 0 ? <p className="admin-empty-note">{documents.length ? "Niciun document nu se potrivește filtrelor." : "Nu există încă documente."}</p>
        : <div className="handed-table-wrap"><table className="handed-table accounting-table">
          <thead><tr>
            <th className="check-cell">{!showExpired && <input type="checkbox" checked={allSelected} aria-label="Selectează toate"
              onChange={() => setSelected(allSelected ? new Set() : new Set(selectable.map((document) => document.id)))} />}</th>
            <th>Document</th><th>Furnizor</th><th>Perioadă</th><th>Colectat</th><th>{showExpired ? "Șters" : "Expiră"}</th><th>Status</th><th />
          </tr></thead>
          <tbody>{shown.map((document) => {
            const state = statusOf(document);
            const expiresSoon = !document.file_deleted_at && Date.parse(document.expires_at) - now < 7 * 86400000;
            return (
              <tr key={document.id} id={`doc-${document.id}`} className={`${state.id === "new" ? "doc-new" : ""} ${highlight === document.id ? "selected" : ""}`}>
                <td className="check-cell">{!document.file_deleted_at && <input type="checkbox" checked={selected.has(document.id)} onChange={() => toggle(document.id)} aria-label={`Selectează ${document.original_name}`} />}</td>
                <td><span className="doc-name">{document.original_name}</span>
                  <small>{[docTypeLabel(document.doc_type), document.invoice_number && `nr. ${document.invoice_number}`, document.issued_on && `emisă ${day(document.issued_on)}`, size(document.size_bytes)].filter(Boolean).join(" · ")}</small></td>
                <td data-label="Furnizor">{document.accounting_suppliers?.name ?? "—"}<small>{document.accounting_companies?.name}</small></td>
                <td className="nowrap" data-label="Perioadă">{document.period}</td>
                <td className="nowrap" data-label="Colectat">{day(document.collected_at)}<small>{collectionMethods[document.collection_method as keyof typeof collectionMethods] ?? document.collection_method}</small></td>
                <td className={`nowrap ${expiresSoon ? "expires-soon" : ""}`} data-label={document.file_deleted_at ? "Șters" : "Expiră"}>{document.file_deleted_at ? day(document.file_deleted_at) : day(document.expires_at)}</td>
                <td><span className={`doc-status ${state.id}`}>{state.label}</span></td>
                <td className="nowrap doc-actions">{!document.file_deleted_at && <>
                  {document.mime_type === "application/pdf" && <a className="text-button" href={`/accounting/documents/${document.id}/file?mode=view`} target="_blank" rel="noopener noreferrer">Vezi</a>}
                  <a className="text-button" href={`/accounting/documents/${document.id}/file`} onClick={() => setTimeout(() => router.refresh(), 2000)}>Descarcă</a>
                </>}</td>
              </tr>
            );
          })}</tbody>
        </table></div>}
    </section>
  );
}

type Item = { name: string; state: "waiting" | "uploading" | "done" | "duplicate" | "error"; message?: string };

// Admin: upload PDF / CSV / XLSX files for a company and supplier. Each file goes straight to the private bucket,
// then the server checks it, drops duplicates and files it.
function UploadPanel({ companies, suppliers, onDone }: { companies: Option[]; suppliers: SupplierOption[]; onDone: () => void }) {
  const [company, setCompany] = useState(companies.length === 1 ? companies[0].id : "");
  const [supplier, setSupplier] = useState("");
  const [type, setType] = useState("");
  const [period, setPeriod] = useState(thisMonth());
  const [invoiceNumber, setInvoiceNumber] = useState("");
  const [issuedOn, setIssuedOn] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [pending, setPending] = useState(false);
  const chosenType = type || suppliers.find((item) => item.id === supplier)?.default_doc_type || "external_invoice";

  function upload() {
    const queue = files;
    setItems(queue.map((file) => ({ name: file.name, state: "waiting" })));
    setPending(true);
    // Plain async (not a transition) so each file's progress shows as it happens.
    void (async () => {
      try {
        const storage = createClient().storage.from("accounting-documents");
        for (let index = 0; index < queue.length; index++) {
          const file = queue[index];
          const set = (item: Partial<Item>) => setItems((current) => current.map((row, i) => i === index ? { ...row, ...item } : row));
          const kind = kindFromName(file.name);
          if (!kind) { set({ state: "error", message: "Doar PDF, CSV sau XLSX." }); continue; }
          if (file.size > maxDocumentBytes) { set({ state: "error", message: "Peste 25 MB." }); continue; }
          set({ state: "uploading" });
          const ticket = await startManualUpload(file.name, file.size);
          if (!ticket.ok) { set({ state: "error", message: ticket.error }); continue; }
          const { error } = await storage.uploadToSignedUrl(ticket.path, ticket.token, file, { contentType: kindMime[kind] });
          if (error) { set({ state: "error", message: "Încărcarea nu a reușit." }); continue; }
          // One invoice number / issue date only makes sense for a single file.
          const result = await finishManualUpload({ path: ticket.path, fileName: file.name, companyId: company, supplierId: supplier, docType: chosenType, period,
            invoiceNumber: queue.length === 1 ? invoiceNumber : "", issuedOn: queue.length === 1 ? issuedOn : "" });
          set(result.status === "created" ? { state: "done", message: "Salvat" } : result.status === "duplicate" ? { state: "duplicate", message: result.message } : { state: "error", message: result.message });
        }
        setFiles([]);
        onDone();
      } finally {
        setPending(false);
      }
    })();
  }

  return (
    <div className="accounting-upload">
      <div className="partner-billing-grid">
        <label>Companie<select value={company} onChange={(event) => setCompany(event.target.value)}><option value="">Alege compania</option>{companies.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
        <label>Furnizor<select value={supplier} onChange={(event) => setSupplier(event.target.value)}><option value="">Alege furnizorul</option>{suppliers.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
        <label>Tip document<select value={chosenType} onChange={(event) => setType(event.target.value)}>{docTypes.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
        <label>Perioadă contabilă<input type="month" value={period} onChange={(event) => setPeriod(event.target.value)} /></label>
        {files.length <= 1 && <>
          <label><span>Nr. factură <span className="optional">opțional</span></span><input value={invoiceNumber} maxLength={80} onChange={(event) => setInvoiceNumber(event.target.value)} /></label>
          <label><span>Data emiterii <span className="optional">opțional</span></span><input type="date" value={issuedOn} onChange={(event) => setIssuedOn(event.target.value)} /></label>
        </>}
      </div>
      <div className="accounting-upload-actions">
        <label className="button button-outline file-button">{files.length ? `${files.length} ${files.length === 1 ? "fișier ales" : "fișiere alese"}` : "Alege fișiere (PDF, CSV, XLSX)"}
          <input type="file" multiple accept=".pdf,.csv,.xlsx,application/pdf,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            onChange={(event) => { setFiles([...(event.target.files ?? [])]); setItems([]); }} /></label>
        <button type="button" className="button button-primary" disabled={pending || !files.length || !company || !supplier || !period} onClick={upload}>{pending ? "Se încarcă…" : "Încarcă"}</button>
      </div>
      {items.length > 0 && <ul className="upload-results">{items.map((item, index) => <li key={index} className={item.state}>
        <span>{item.name}</span><small>{item.state === "waiting" ? "în așteptare" : item.state === "uploading" ? "se încarcă…" : item.message}</small></li>)}</ul>}
    </div>
  );
}
