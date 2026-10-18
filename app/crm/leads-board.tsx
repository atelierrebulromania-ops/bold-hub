"use client";

import Link from "next/link";
import { Fragment, useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { lookupCompany, type ClientInput } from "@/app/account/actions";
import {
  addLeadNote, claimLead, convertLead, createLead, getLeadActivity, importLeads, postponeFollowUp, releaseLead, setLeadStatus,
  type LeadActivity, type ManualLead,
} from "./actions";

export type Lead = {
  id: string; source: string; campaign: string | null; ad_name: string | null; form_name: string | null;
  full_name: string | null; company: string | null; phone: string | null; email: string | null; city: string | null;
  message: string | null; answers: Record<string, string> | null; status: string; lost_reason: string | null;
  claimed_by: string | null; claimed_at: string | null; partner_id: string | null; received_at: string; follow_up_at: string | null;
};

type Tab = "new" | "working" | "won" | "lost" | "all";
type Result = { ok: boolean; message: string };

const stages: { value: string; label: string; tone: string }[] = [
  { value: "new", label: "Nou", tone: "new" },
  { value: "to_contact", label: "De contactat", tone: "soon" },
  { value: "contacted", label: "Contactat", tone: "open" },
  { value: "offer", label: "Ofertă trimisă", tone: "offer" },
  { value: "won", label: "Câștigat", tone: "paid" },
  { value: "lost", label: "Pierdut", tone: "overdue" },
];
const stageOf = (value: string) => stages.find((stage) => stage.value === value) ?? stages[0];
const sourceLabels: Record<string, string> = { meta: "Meta", website: "Site", google: "Google", tiktok: "TikTok", manual: "Manual", import: "Import" };
const lostReasons = ["Preț", "Nu răspunde", "Nu e potrivit", "A ales alt furnizor", "Altul"];
const tabs: { value: Tab; label: string }[] = [
  { value: "new", label: "Noi" }, { value: "working", label: "În lucru" }, { value: "won", label: "Câștigați" },
  { value: "lost", label: "Pierduți" }, { value: "all", label: "Toate" },
];

function inTab(lead: Lead, tab: Tab) {
  if (tab === "all") return true;
  if (tab === "won" || tab === "lost") return lead.status === tab;
  const open = lead.status !== "won" && lead.status !== "lost";
  return open && (tab === "new" ? !lead.claimed_by : !!lead.claimed_by);
}

function when(value: string) {
  return new Intl.DateTimeFormat("ro-RO", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Bucharest" }).format(new Date(value));
}

// The reply deadline of a sent offer: "răspuns în 3 zile", or overdue.
function deadline(lead: Lead, now: number): { label: string; late: boolean } | null {
  if (lead.status !== "offer" || !lead.follow_up_at) return null;
  const hours = Math.round((new Date(lead.follow_up_at).getTime() - now) / 3600000);
  const span = (value: number) => value >= 48 ? `${Math.round(value / 24)} zile` : value >= 24 ? "o zi" : `${Math.max(value, 1)} h`;
  return hours >= 0 ? { label: `răspuns în ${span(hours)}`, late: false } : { label: `depășit cu ${span(-hours)}`, late: true };
}

function title(lead: Lead) {
  return lead.company || lead.full_name || lead.email || lead.phone || "Lead fără nume";
}

export function LeadsBoard({ leads, names, currentUserId, canWork }: { leads: Lead[]; names: Record<string, string>; currentUserId: string; canWork: boolean }) {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("new");
  const [mine, setMine] = useState(false);
  const [query, setQuery] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [importing, setImporting] = useState(false);
  const [pending, startTransition] = useTransition();
  const [feedback, setFeedback] = useState<Result | null>(null);

  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const timer = window.setInterval(() => setNow(Date.now()), 60000); return () => window.clearInterval(timer); }, []);
  const search = query.trim().toLowerCase();
  const visible = useMemo(() => leads.filter((lead) => inTab(lead, tab) && (!mine || lead.claimed_by === currentUserId)
    && (!search || [lead.full_name, lead.company, lead.phone, lead.email, lead.campaign, lead.city].some((value) => value?.toLowerCase().includes(search)))),
  [leads, tab, mine, search, currentUserId]);
  const counts = useMemo(() => Object.fromEntries(tabs.map((item) => [item.value, leads.filter((lead) => inTab(lead, item.value)).length])), [leads]);
  const open = openId ? leads.find((lead) => lead.id === openId) ?? null : null;

  function run(action: () => Promise<Result>, after?: () => void) {
    startTransition(async () => {
      const result = await action();
      setFeedback(result);
      if (result.ok) { router.refresh(); after?.(); }
    });
  }

  return (
    <>
      <section className="board-panel" aria-label="Lead-uri">
        <div className="board-panel-heading">
          <div><h2>Lead-uri</h2><p>{counts.new ? `${counts.new} ${counts.new === 1 ? "lead nou așteaptă" : "lead-uri noi așteaptă"} să fie preluate.` : "Toate lead-urile noi au fost preluate."}</p></div>
          {canWork && <div className="crm-heading-actions">
            <button type="button" className="button button-outline" onClick={() => setImporting(true)}>Importă CSV</button>
            <button type="button" className="button button-primary" onClick={() => setAdding(true)}>+ Lead nou</button>
          </div>}
        </div>
        <nav className="board-tabs" aria-label="Etape">
          {tabs.map((item) => <button key={item.value} type="button" className={tab === item.value ? "active" : ""} onClick={() => setTab(item.value)}>{item.label}<span>{counts[item.value]}</span></button>)}
        </nav>
        <div className="crm-filters">
          <input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Caută nume, firmă, telefon, email, campanie…" aria-label="Caută lead" />
          {canWork && <label className="admin-checkbox"><input type="checkbox" checked={mine} onChange={(event) => setMine(event.target.checked)} /> Doar ale mele</label>}
        </div>
        {feedback && !openId && <p className={`action-feedback ${feedback.ok ? "success" : "error"} crm-feedback`} role="status">{feedback.message}</p>}
        {visible.length === 0 ? <p className="admin-empty-note crm-empty">{tab === "new" ? "Niciun lead nou de preluat." : "Niciun lead aici."}</p>
          : <div className="handed-table-wrap"><table className="handed-table">
            <thead><tr><th>Lead</th><th>Contact</th><th>Sursă</th><th>Primit</th><th>Etapă</th><th>Preluat de</th></tr></thead>
            <tbody>{visible.map((lead) => {
              const stage = stageOf(lead.status);
              return <tr key={lead.id} className={`handed-row ${openId === lead.id ? "selected" : ""}`} onClick={() => { setOpenId(lead.id); setFeedback(null); }}>
                <td><button type="button" className="row-button strong" onClick={(event) => { event.stopPropagation(); setOpenId(lead.id); setFeedback(null); }}>{title(lead)}</button>
                  {lead.company && lead.full_name && <small>{lead.full_name}</small>}</td>
                <td className="nowrap">{lead.phone ?? "—"}{lead.email && <small>{lead.email}</small>}</td>
                <td><span className="crm-source">{sourceLabels[lead.source] ?? lead.source}</span>{(lead.campaign || lead.form_name) && <small>{lead.campaign ?? lead.form_name}</small>}</td>
                <td className="nowrap">{when(lead.received_at)}</td>
                <td><span className={`payment-chip ${stage.tone}`}>{stage.label}</span>{(() => {
                  const due = deadline(lead, now);
                  return due && <small className={due.late ? "crm-late" : ""}>{due.label}</small>;
                })()}</td>
                <td className="nowrap">{lead.claimed_by
                  ? names[lead.claimed_by] ?? "—"
                  : canWork && lead.status !== "won" && lead.status !== "lost"
                    ? <button type="button" className="button button-primary crm-claim" disabled={pending} onClick={(event) => { event.stopPropagation(); run(() => claimLead(lead.id)); }}>Preia</button>
                    : <span className="muted-cell">Nepreluat</span>}</td>
              </tr>;
            })}</tbody>
          </table></div>}
      </section>

      {open && <LeadPanel key={open.id} lead={open} names={names} currentUserId={currentUserId} canWork={canWork} pending={pending}
        feedback={feedback} run={run} onClose={() => { setOpenId(null); setFeedback(null); }} />}
      {adding && <AddLeadPanel onClose={() => setAdding(false)} onSaved={(id) => { setAdding(false); router.refresh(); setTab("new"); setOpenId(id); }} />}
      {importing && <ImportPanel onClose={() => setImporting(false)} onDone={() => router.refresh()} />}
    </>
  );
}

function LeadPanel({ lead, names, currentUserId, canWork, pending, feedback, run, onClose }: {
  lead: Lead; names: Record<string, string>; currentUserId: string; canWork: boolean; pending: boolean; feedback: Result | null;
  run: (action: () => Promise<Result>, after?: () => void) => void; onClose: () => void;
}) {
  const [activity, setActivity] = useState<LeadActivity[] | null>(null);
  const [note, setNote] = useState("");
  const [writing, setWriting] = useState(false);
  const [lostReason, setLostReason] = useState("");
  const [losing, setLosing] = useState(false);
  const [converting, setConverting] = useState(false);
  const holder = lead.claimed_by === currentUserId;
  const closed = lead.status === "won" || lead.status === "lost";
  const stage = stageOf(lead.status);

  useEffect(() => {
    let live = true;
    getLeadActivity(lead.id).then((rows) => { if (live) setActivity(rows); });
    return () => { live = false; };
  }, [lead.id, lead.status, lead.claimed_by, feedback]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const answers = Object.entries(lead.answers ?? {});
  return <>
    <div className="detail-backdrop" onClick={onClose} aria-hidden="true" />
    <aside className="detail-panel" aria-label="Lead">
      <div className="detail-header"><div><p className="eyebrow">{sourceLabels[lead.source] ?? lead.source}{lead.campaign ? ` · ${lead.campaign}` : ""}</p><h2>{title(lead)}</h2>
        <p className="crm-panel-meta"><span className={`payment-chip ${stage.tone}`}>{stage.label}</span>
          {lead.claimed_by ? <span>Preluat de {names[lead.claimed_by] ?? "—"}</span> : <span>Nepreluat</span>}</p></div>
        <button className="close-button" aria-label="Închide" onClick={onClose}>×</button></div>
      <div className="detail-scroll">
        <section className="detail-section"><h3>Contact</h3>
          <dl className="crm-fields">
            {lead.full_name && <><dt>Nume</dt><dd>{lead.full_name}</dd></>}
            {lead.company && <><dt>Firmă</dt><dd>{lead.company}</dd></>}
            {lead.phone && <><dt>Telefon</dt><dd><a href={`tel:${lead.phone.replace(/\s+/g, "")}`}>{lead.phone}</a></dd></>}
            {lead.email && <><dt>Email</dt><dd><a href={`mailto:${lead.email}`}>{lead.email}</a></dd></>}
            {lead.city && <><dt>Oraș</dt><dd>{lead.city}</dd></>}
            <dt>Primit</dt><dd>{when(lead.received_at)}</dd>
            {lead.form_name && <><dt>Formular</dt><dd>{lead.form_name}</dd></>}
            {lead.ad_name && <><dt>Reclamă</dt><dd>{lead.ad_name}</dd></>}
          </dl>
          {lead.message && <p className="crm-message">{lead.message}</p>}
        </section>
        {answers.length > 0 && <section className="detail-section"><h3>Răspunsuri din formular</h3>
          <dl className="crm-fields">{answers.map(([question, answer]) => <Fragment key={question}><dt>{question}</dt><dd>{answer}</dd></Fragment>)}</dl></section>}

        {lead.partner_id && <section className="detail-section"><h3>Client</h3><p>Lead câștigat. <Link href="/account" className="text-button">Vezi clienții</Link></p></section>}

        {canWork && !closed && <section className="detail-section"><h3>Etapă</h3>
          {!lead.claimed_by ? <button type="button" className="button button-primary" disabled={pending} onClick={() => run(() => claimLead(lead.id))}>Preia lead-ul</button>
            : !holder ? <p className="muted">Lead-ul e preluat de {names[lead.claimed_by] ?? "alt agent"}. Doar el îl poate muta între etape.</p>
            : <>
              <ol className="crm-stepper">{stages.filter((item) => ["to_contact", "contacted", "offer"].includes(item.value)).map((item, index, list) => {
                const current = list.findIndex((step) => step.value === lead.status);
                const state = index < current ? "done" : index === current ? "current" : "next";
                return <li key={item.value} className={state}>
                  <button type="button" disabled={pending || state === "current"} onClick={() => run(() => setLeadStatus(lead.id, item.value, ""))}
                    aria-current={state === "current" ? "step" : undefined}>
                    <span className="crm-step-dot" aria-hidden="true">{state === "done" ? "✓" : index + 1}</span>{item.label}</button>
                </li>;
              })}</ol>
              {lead.status === "offer" && (() => {
                const due = deadline(lead, Date.now());
                return due && <div className={`crm-deadline ${due.late ? "late" : ""}`}>
                  <span><strong>{due.late ? "Termen depășit" : "Așteaptă răspuns"}</strong> · {due.label}</span>
                  <span className="crm-deadline-actions">Amână:{[3, 7, 14].map((days) =>
                    <button key={days} type="button" className="text-button" disabled={pending} onClick={() => run(() => postponeFollowUp(lead.id, days))}>+{days} zile</button>)}</span>
                </div>;
              })()}
            </>}
        </section>}

        {canWork && !closed && holder && <section className="detail-section"><h3>Rezultat</h3>
          {!losing ? <div className="crm-result">
            <button type="button" className="button crm-won" disabled={pending} onClick={() => setConverting(true)}>✓ Câștigat<small>devine client nou</small></button>
            <button type="button" className="button crm-lost-button" disabled={pending} onClick={() => setLosing(true)}>✕ Pierdut<small>alege motivul</small></button>
          </div> : <div className="crm-lost-box">
            <p>De ce s-a pierdut?</p>
            <div className="crm-reasons">{lostReasons.map((reason) => <button key={reason} type="button" className={lostReason === reason ? "selected" : ""}
              onClick={() => setLostReason(reason)}>{reason}</button>)}</div>
            <div className="crm-lost-actions">
              <button type="button" className="button button-danger" disabled={pending || !lostReason} onClick={() => run(() => setLeadStatus(lead.id, "lost", lostReason), () => setLosing(false))}>Marchează pierdut</button>
              <button type="button" className="button button-outline" disabled={pending} onClick={() => { setLosing(false); setLostReason(""); }}>Renunță</button>
            </div>
          </div>}
        </section>}
        {lead.status === "lost" && <section className="detail-section"><h3>Pierdut</h3><p>{lead.lost_reason ?? "Fără motiv."}</p>
          {canWork && (holder || !lead.claimed_by) && <button type="button" className="text-button" disabled={pending} onClick={() => run(() => setLeadStatus(lead.id, "contacted", ""))}>Redeschide</button>}</section>}

        {feedback && <p className={`action-feedback ${feedback.ok ? "success" : "error"}`} role="status" aria-live="polite">{feedback.message}</p>}

        <section className="detail-section"><div className="crm-section-heading"><h3>Istoric</h3>
          {canWork && !writing && <button type="button" className="text-button" onClick={() => setWriting(true)}>+ Adaugă notiță</button>}</div>
          {writing && <div className="crm-note-box">
            <textarea className="crm-note" value={note} maxLength={4000} rows={3} autoFocus onChange={(event) => setNote(event.target.value)} placeholder="Ce s-a discutat, ce urmează…" />
            <div className="crm-lost-actions">
              <button type="button" className="button button-primary" disabled={pending || !note.trim()} onClick={() => run(() => addLeadNote(lead.id, note), () => { setNote(""); setWriting(false); })}>Salvează</button>
              <button type="button" className="button button-outline" disabled={pending} onClick={() => { setWriting(false); setNote(""); }}>Renunță</button>
            </div>
          </div>}
          {activity === null ? <p className="muted">Se încarcă…</p> : activity.length === 0 ? <p className="muted">Nimic încă.</p>
            : <ul className="crm-timeline">{activity.map((item) => <li key={item.id} className={item.kind}>
              <p>{item.body}</p><small>{item.user_name ?? "Sistem"} · {when(item.created_at)}</small></li>)}</ul>}
        </section>
      </div>
      {!canWork && <div className="detail-actions"><p className="muted">Ai acces doar de vizualizare.</p></div>}
      {canWork && holder && !closed && <div className="detail-actions crm-panel-footer">
        <button type="button" className="button button-outline" disabled={pending} onClick={() => run(() => releaseLead(lead.id))}>Eliberează lead-ul</button>
        <small>Îl pune înapoi în lista comună, ca să-l preia altcineva.</small>
      </div>}
    </aside>
    {converting && <ConvertPanel lead={lead} onClose={() => setConverting(false)} run={run} />}
  </>;
}

const emptyLead: ManualLead = { full_name: "", company: "", phone: "", email: "", city: "", message: "" };

function AddLeadPanel({ onClose, onSaved }: { onClose: () => void; onSaved: (id: string) => void }) {
  const [input, setInput] = useState<ManualLead>(emptyLead);
  const [feedback, setFeedback] = useState<Result | null>(null);
  const [pending, startTransition] = useTransition();
  const set = (key: keyof ManualLead, value: string) => setInput({ ...input, [key]: value });
  return <>
    <div className="detail-backdrop" onClick={onClose} aria-hidden="true" />
    <aside className="detail-panel" aria-label="Lead nou">
      <div className="detail-header"><div><p className="eyebrow">LEAD</p><h2>Lead nou</h2></div><button className="close-button" aria-label="Închide" onClick={onClose}>×</button></div>
      <div className="detail-scroll"><div className="form-stack">
        <label>Nume<input value={input.full_name} maxLength={200} autoFocus onChange={(event) => set("full_name", event.target.value)} /></label>
        <label>Firmă<input value={input.company} maxLength={200} onChange={(event) => set("company", event.target.value)} /></label>
        <label>Telefon<input value={input.phone} maxLength={60} onChange={(event) => set("phone", event.target.value)} /></label>
        <label>Email<input type="email" value={input.email} maxLength={254} onChange={(event) => set("email", event.target.value)} /></label>
        <label>Oraș<input value={input.city} maxLength={120} onChange={(event) => set("city", event.target.value)} /></label>
        <label>Detalii<textarea value={input.message} maxLength={4000} rows={4} onChange={(event) => set("message", event.target.value)} /></label>
      </div>
      {feedback && <p className={`action-feedback ${feedback.ok ? "success" : "error"}`} role="status">{feedback.message}</p>}</div>
      <div className="detail-actions"><button className="button button-primary" disabled={pending || (!input.full_name.trim() && !input.company.trim())}
        onClick={() => startTransition(async () => { const result = await createLead(input); setFeedback(result); if (result.ok && result.id) onSaved(result.id); })}>Adaugă lead-ul</button></div>
    </aside>
  </>;
}

// Meta Leads Center exports UTF-16 with tabs; sheets usually save UTF-8 with commas or semicolons.
function parseCsv(buffer: ArrayBuffer): Record<string, string>[] {
  const bytes = new Uint8Array(buffer);
  const text = bytes[0] === 0xff && bytes[1] === 0xfe ? new TextDecoder("utf-16le").decode(buffer) : new TextDecoder("utf-8").decode(buffer);
  const clean = text.replace(/^﻿/, "");
  const firstLine = clean.split(/\r?\n/, 1)[0] ?? "";
  const delimiter = ["\t", ";", ","].sort((a, b) => firstLine.split(b).length - firstLine.split(a).length)[0];
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let index = 0; index < clean.length; index++) {
    const char = clean[index];
    if (quoted) {
      if (char === '"' && clean[index + 1] === '"') { cell += '"'; index++; }
      else if (char === '"') quoted = false;
      else cell += char;
    } else if (char === '"') quoted = true;
    else if (char === delimiter) { row.push(cell); cell = ""; }
    else if (char === "\n" || char === "\r") {
      if (char === "\r" && clean[index + 1] === "\n") index++;
      row.push(cell); rows.push(row); row = []; cell = "";
    } else cell += char;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  const [header, ...body] = rows.filter((line) => line.some((value) => value.trim()));
  if (!header) return [];
  return body.map((line) => Object.fromEntries(header.map((name, column) => [name.trim(), (line[column] ?? "").trim()])));
}

function ImportPanel({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [rows, setRows] = useState<Record<string, string>[] | null>(null);
  const [source, setSource] = useState<"meta" | "website">("meta");
  const [feedback, setFeedback] = useState<Result | null>(null);
  const [pending, startTransition] = useTransition();
  return <>
    <div className="detail-backdrop" onClick={onClose} aria-hidden="true" />
    <aside className="detail-panel" aria-label="Importă lead-uri">
      <div className="detail-header"><div><p className="eyebrow">LEAD</p><h2>Importă lead-uri din CSV</h2></div><button className="close-button" aria-label="Închide" onClick={onClose}>×</button></div>
      <div className="detail-scroll"><div className="form-stack">
        <p className="muted">Din Meta: Leads Center (sau Business Suite → Toate instrumentele → Formulare instant) → Descarcă → CSV. Lead-urile deja existente sunt sărite.</p>
        <label>De unde vin<select value={source} onChange={(event) => setSource(event.target.value as "meta" | "website")}><option value="meta">Meta (Facebook / Instagram)</option><option value="website">Site / altă sursă</option></select></label>
        <label>Fișier CSV<input type="file" accept=".csv,text/csv,text/tab-separated-values" onChange={async (event) => {
          const file = event.target.files?.[0];
          setFeedback(null);
          if (!file) { setRows(null); return; }
          if (file.size > 5_000_000) { setFeedback({ ok: false, message: "Fișierul e prea mare (maximum 5 MB)." }); return; }
          const parsed = parseCsv(await file.arrayBuffer());
          setRows(parsed);
          if (!parsed.length) setFeedback({ ok: false, message: "Nu am găsit rânduri în fișier." });
        }} /></label>
        {rows && rows.length > 0 && <p>{rows.length} rânduri găsite. Coloane: {Object.keys(rows[0]).slice(0, 8).join(", ")}{Object.keys(rows[0]).length > 8 ? "…" : ""}</p>}
      </div>
      {feedback && <p className={`action-feedback ${feedback.ok ? "success" : "error"}`} role="status">{feedback.message}</p>}</div>
      <div className="detail-actions"><button className="button button-primary" disabled={pending || !rows?.length}
        onClick={() => startTransition(async () => { const result = await importLeads(rows!, source); setFeedback(result); if (result.ok) { setRows(null); onDone(); } })}>{pending ? "Se importă…" : "Importă"}</button></div>
    </aside>
  </>;
}

function ConvertPanel({ lead, onClose, run }: { lead: Lead; onClose: () => void; run: (action: () => Promise<Result>, after?: () => void) => void }) {
  const [input, setInput] = useState<ClientInput>({
    businessName: lead.company ?? lead.full_name ?? "", locationName: lead.city ?? "", contactPhone: lead.phone ?? "", contactEmail: lead.email ?? "",
    type: "horeca", isImportantClient: false, billingName: "", vatId: "", registrationNumber: "", street: "", city: lead.city ?? "", county: "", zip: "",
  });
  const [feedback, setFeedback] = useState<Result | null>(null);
  const [pending, startTransition] = useTransition();
  const set = <K extends keyof ClientInput>(key: K, value: ClientInput[K]) => setInput({ ...input, [key]: value });

  function fromAnaf() {
    startTransition(async () => {
      const result = await lookupCompany(input.vatId);
      setFeedback({ ok: result.ok, message: result.message });
      if (result.company) {
        const company = result.company;
        setInput((current) => ({ ...current, vatId: company.vatId, billingName: company.name, registrationNumber: company.registrationNumber,
          street: company.street, city: company.city, county: company.county, zip: company.zip,
          businessName: current.businessName || company.name, locationName: current.locationName || company.city }));
      }
    });
  }

  return <>
    <div className="detail-backdrop crm-convert-backdrop" onClick={onClose} aria-hidden="true" />
    <aside className="detail-panel crm-convert" aria-label="Client nou din lead">
      <div className="detail-header"><div><p className="eyebrow">LEAD CÂȘTIGAT</p><h2>Client nou</h2></div><button className="close-button" aria-label="Închide" onClick={onClose}>×</button></div>
      <div className="detail-scroll"><div className="form-stack">
        <label>CUI<span className="crm-cui"><input value={input.vatId} maxLength={20} onChange={(event) => set("vatId", event.target.value)} placeholder="ex. RO12345678" />
          <button type="button" className="button button-outline" disabled={pending || !input.vatId.trim()} onClick={fromAnaf}>Caută la ANAF</button></span></label>
        <label>Denumire firmă (facturare)<input value={input.billingName} onChange={(event) => set("billingName", event.target.value)} /></label>
        <label>Nume client (afișat)<input value={input.businessName} onChange={(event) => set("businessName", event.target.value)} /></label>
        <label>Locație<input value={input.locationName} onChange={(event) => set("locationName", event.target.value)} /></label>
        <label>Telefon<input value={input.contactPhone} onChange={(event) => set("contactPhone", event.target.value)} /></label>
        <label>Email<input value={input.contactEmail} onChange={(event) => set("contactEmail", event.target.value)} /></label>
        <label>Tip<select value={input.type} onChange={(event) => set("type", event.target.value as ClientInput["type"])}>
          <option value="horeca">HoReCa</option><option value="reseller">Revânzător</option><option value="altul">Altul</option></select></label>
        <label>Stradă<input value={input.street} onChange={(event) => set("street", event.target.value)} /></label>
        <label>Oraș<input value={input.city} onChange={(event) => set("city", event.target.value)} /></label>
        <label>Județ<input value={input.county} onChange={(event) => set("county", event.target.value)} /></label>
      </div>
      {feedback && <p className={`action-feedback ${feedback.ok ? "success" : "error"}`} role="status">{feedback.message}</p>}</div>
      <div className="detail-actions"><button className="button button-primary" disabled={pending}
        onClick={() => run(async () => { const result = await convertLead(lead.id, input); setFeedback(result); return result; }, onClose)}>Creează clientul</button></div>
    </aside>
  </>;
}
