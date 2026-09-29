"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { formatDateTime } from "@/lib/orders";
import { discountFor, documentTotals, formatMoney, type DiscountRule } from "@/lib/pricing";
import { cancelProforma, checkProforma, issueDocument, lookupCompany, offerToProforma, requestDocumentInvoice, reserveDocumentOrder, saveDocument, type DocumentInput } from "../../actions";

export type EditorDocument = {
  id: string; kind: string; number: string | null; status: string; partner_id: string | null;
  client_name: string; client_vat_id: string | null; client_registration: string | null; client_street: string | null;
  client_city: string | null; client_county: string | null; client_zip: string | null; contact_name: string | null;
  contact_email: string | null; contact_phone: string | null; save_as_partner: boolean; discount_percent: number;
  validity_days: number; notes: string | null; bocp_error: string | null; bocp_order_id: string | null; bocp_proforma_total: number | null;
  cart_id: string | null; invoice_requested_at: string | null; invoiced_at: string | null; invoice_number: string | null; invoice_date: string | null;
  bocp_invoice_id: string | null; cancel_requested_at: string | null; cancel_reason: string | null; cancelled_at: string | null; issued_at: string | null;
  source_document_id: string | null;
  partner_carts: { id: string; status: string; prepared_at: string | null; delivered_at: string | null; invoiced_at: string | null; invoice_number: string | null; bocp_invoice_id: string | null } | null;
  sales_document_items: { product_id: string; sku: string; name: string; quantity: number; unit_price: number; vat_percent: number; discount_percent: number | null; position: number }[];
};
export type EditorClient = {
  id: string; business_name: string; billing_name: string | null; vat_id: string | null; registration_number: string | null;
  billing_street: string | null; billing_city: string | null; billing_county: string | null; billing_zip: string | null;
  contact_phone: string; contact_email: string | null; partner_discounts: DiscountRule[];
};
export type EditorCollection = { id: string; name: string; productIds: string[] };
export type RelatedDocument = { id: string; kind: string; number: string | null; status: string };
export type EditorProduct = { id: string; name: string; sku: string; category: string | null; list_price: number | null; vat_percent: number | null };

// `discount` is the product's own discount ("" = it takes the document's).
type Line = { productId: string; name: string; sku: string; quantity: string; unitPrice: number; vatPercent: number; discount: string };

type EditorProps = {
  document: EditorDocument | null; related: RelatedDocument[]; initialKind: "offer" | "proforma"; clients: EditorClient[]; catalog: EditorProduct[];
  collections: EditorCollection[]; startCollection: EditorCollection | null;
};

// "Renunță la modificări" starts the form again from the saved document.
export function DocumentEditor(props: EditorProps) {
  const [version, setVersion] = useState(0);
  return <Editor key={`${props.document?.id ?? "new"}-${version}`} {...props} onReset={() => setVersion((current) => current + 1)} />;
}

function Editor({ document, related, initialKind, clients, catalog, collections, startCollection, onReset }: EditorProps & { onReset: () => void }) {
  const router = useRouter();
  // An issued offer can be edited again (it keeps its number); proformas are locked once in BOCP.
  const [editing, setEditing] = useState(false);
  const reopenable = document?.kind === "offer" && document.status === "issued";
  const editable = !document || document.status === "draft" || (reopenable && editing);
  const [kind, setKind] = useState<"offer" | "proforma">(initialKind);
  const [partnerId, setPartnerId] = useState<string | null>(document?.partner_id ?? null);
  const [client, setClient] = useState({
    name: document?.client_name ?? "", vatId: document?.client_vat_id ?? "", registration: document?.client_registration ?? "",
    street: document?.client_street ?? "", city: document?.client_city ?? "", county: document?.client_county ?? "", zip: document?.client_zip ?? "",
    contactName: document?.contact_name ?? "", contactEmail: document?.contact_email ?? "", contactPhone: document?.contact_phone ?? "",
  });
  const [saveAsPartner, setSaveAsPartner] = useState(document?.save_as_partner ?? false);
  const [discount, setDiscount] = useState(String(document?.discount_percent ?? 0));
  const [validity, setValidity] = useState(String(document?.validity_days ?? 15));
  const [notes, setNotes] = useState(document?.notes ?? "");
  const [lines, setLines] = useState<Line[]>(() => document
    ? [...document.sales_document_items].sort((a, b) => a.position - b.position).map((item) => ({
      productId: item.product_id, name: item.name, sku: item.sku, quantity: String(item.quantity), unitPrice: item.unit_price, vatPercent: item.vat_percent,
      discount: item.discount_percent === null ? "" : String(item.discount_percent),
    }))
    : startCollection ? collectionLines(startCollection, catalog, []) : []);
  const [collectionId, setCollectionId] = useState("");
  const [query, setQuery] = useState("");
  const [feedback, setFeedback] = useState<{ ok: boolean; message: string } | null>(null);
  const [pending, start] = useTransition();

  const discountValue = Number(discount.replace(",", ".")) || 0;
  const lineDiscountOf = (line: Line) => line.discount === "" ? discountValue : percent(line.discount);
  const totals = documentTotals(lines.map((line) => ({ quantity: Number(line.quantity) || 0, unit_price: line.unitPrice, vat_percent: line.vatPercent,
    discount_percent: line.discount === "" ? null : percent(line.discount) })), discountValue);
  const customLines = lines.filter((line) => line.discount !== "").length;
  // Rows ticked to set their discount together.
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [bulkDiscount, setBulkDiscount] = useState("");
  const setLineDiscount = (productIds: Set<string>, value: string) =>
    setLines((current) => current.map((line) => productIds.has(line.productId) ? { ...line, discount: value } : line));
  const togglePicked = (productId: string) => setPicked((current) => {
    const next = new Set(current);
    if (next.has(productId)) next.delete(productId); else next.add(productId);
    return next;
  });
  const needle = query.trim().toLocaleLowerCase("ro");
  const matches = needle.length < 2 ? [] : catalog.filter((item) => !lines.some((line) => line.productId === item.id)
    && `${item.name} ${item.sku}`.toLocaleLowerCase("ro").includes(needle)).slice(0, 8);
  const setField = (key: keyof typeof client, value: string) => setClient({ ...client, [key]: value });

  function pickClient(id: string) {
    const found = clients.find((item) => item.id === id);
    setPartnerId(found?.id ?? null);
    if (!found) return;
    setClient({
      name: found.billing_name ?? found.business_name, vatId: found.vat_id ?? "", registration: found.registration_number ?? "",
      street: found.billing_street ?? "", city: found.billing_city ?? "", county: found.billing_county ?? "", zip: found.billing_zip ?? "",
      contactName: "", contactEmail: found.contact_email ?? "", contactPhone: found.contact_phone,
    });
    setSaveAsPartner(false);
    // The client's discount on the whole range is the starting point for the document.
    setDiscount(String(discountFor(found.partner_discounts, null)));
  }

  // Adds a collection's products (quantity 1) that are not on the document yet.
  function addCollection(id: string) {
    const collection = collections.find((item) => item.id === id);
    setCollectionId("");
    if (!collection) return;
    const added = collectionLines(collection, catalog, lines);
    setLines([...lines, ...added]);
    setFeedback({ ok: true, message: added.length
      ? `Am adăugat ${added.length} ${added.length === 1 ? "produs" : "produse"} din „${collection.name}”. Setează cantitățile sau scoate ce nu trebuie.`
      : `Produsele din „${collection.name}” sunt deja pe document.` });
  }

  function fromAnaf() {
    setFeedback(null);
    start(async () => {
      const result = await lookupCompany(client.vatId);
      if (result.company) {
        const company = result.company;
        setClient((current) => ({ ...current, name: company.name, vatId: company.vatId, registration: company.registrationNumber,
          street: company.street, city: company.city, county: company.county, zip: company.zip }));
      }
      setFeedback({ ok: result.ok, message: result.message });
    });
  }

  function input(): DocumentInput {
    return {
      kind, partnerId, clientName: client.name, clientVatId: client.vatId, clientRegistration: client.registration, clientStreet: client.street,
      clientCity: client.city, clientCounty: client.county, clientZip: client.zip, contactName: client.contactName, contactEmail: client.contactEmail,
      contactPhone: client.contactPhone, saveAsPartner: partnerId === null && saveAsPartner, discountPercent: discountValue,
      validityDays: Math.min(365, Math.max(1, Number(validity) || 15)), notes,
      items: lines.map((line) => ({ productId: line.productId, quantity: Math.max(1, Number(line.quantity) || 1), discountPercent: line.discount === "" ? null : percent(line.discount) })),
    };
  }

  function save(thenIssue: boolean) {
    setFeedback(null);
    start(async () => {
      const saved = await saveDocument(document?.id ?? null, input());
      if (!saved.ok || !saved.id) { setFeedback(saved); return; }
      if (reopenable) {
        setFeedback({ ok: true, message: `Oferta ${document?.number} a fost actualizată.` });
        setEditing(false);
      } else if (thenIssue) {
        const issued = await issueDocument(saved.id);
        setFeedback(issued);
      } else {
        setFeedback(saved);
      }
      if (!document) router.replace(`/account/offers/${saved.id}`);
      else router.refresh();
    });
  }

  // Runs one of the document's actions and refreshes the page with the outcome.
  function act(action: () => Promise<{ ok: boolean; message: string; id?: string }>) {
    setFeedback(null);
    start(async () => {
      const result = await action();
      setFeedback(result);
      if (result.ok && result.id) router.push(`/account/offers/${result.id}`);
      else router.refresh();
    });
  }

  const statusText = !document ? "Ciornă nesalvată" : document.status === "draft" ? "Ciornă"
    : document.status === "issuing" ? "Se emite în BOCP" : document.status === "cancel_requested" ? `${document.number} · anulare cerută`
    : document.status === "cancelled" ? `${document.number} · anulată` : `Emisă · ${document.number}`;

  return (
    <div className="document-editor">
      <section className="board-panel">
        <div className="board-panel-heading">
          <div><h2>{kind === "offer" ? "Ofertă de preț" : "Factură proformă"}</h2><p>{statusText}</p></div>
          {editable && !document && <div className="dashboard-presets" role="group" aria-label="Tip document">
            {(["offer", "proforma"] as const).map((value) => <button key={value} type="button" className={kind === value ? "preset active" : "preset"} onClick={() => setKind(value)}>{value === "offer" ? "Ofertă" : "Proformă"}</button>)}
          </div>}
        </div>

        <div className="document-grid">
          <section className="document-block"><h3>Client</h3>
            {editable && <select className="catalog-select full" value={partnerId ?? ""} onChange={(event) => pickClient(event.target.value)} aria-label="Client">
              <option value="">Client nou (prospect)</option>{clients.map((item) => <option key={item.id} value={item.id}>{item.business_name}</option>)}</select>}
            {editable && partnerId === null && <div className="cui-lookup">
              <label>CUI{kind === "proforma" && <span className="required"> obligatoriu</span>}<input value={client.vatId} maxLength={20} onChange={(event) => setField("vatId", event.target.value)} placeholder="ex. RO42910222" /></label>
              <button type="button" className="button button-outline" disabled={pending || client.vatId.trim().length < 2} onClick={fromAnaf}>Completează din ANAF</button>
            </div>}
            <div className="partner-billing-grid">
              <label>Denumire<input value={client.name} disabled={!editable || partnerId !== null} maxLength={200} onChange={(event) => setField("name", event.target.value)} /></label>
              {(partnerId !== null || !editable) && <label>CUI<input value={client.vatId} disabled /></label>}
              <label>Nr. Reg. Com.<input value={client.registration} disabled={!editable || partnerId !== null} onChange={(event) => setField("registration", event.target.value)} /></label>
              <label>Stradă și număr<input value={client.street} disabled={!editable || partnerId !== null} onChange={(event) => setField("street", event.target.value)} /></label>
              <label>Oraș<input value={client.city} disabled={!editable || partnerId !== null} onChange={(event) => setField("city", event.target.value)} /></label>
              <label>Județ<input value={client.county} disabled={!editable || partnerId !== null} onChange={(event) => setField("county", event.target.value)} /></label>
              <label>Persoană de contact<input value={client.contactName} disabled={!editable} maxLength={120} onChange={(event) => setField("contactName", event.target.value)} /></label>
              <label>Telefon<input value={client.contactPhone} disabled={!editable} maxLength={30} onChange={(event) => setField("contactPhone", event.target.value)} /></label>
              <label>Email<input type="email" value={client.contactEmail} disabled={!editable} maxLength={254} onChange={(event) => setField("contactEmail", event.target.value)} /></label>
            </div>
            {editable && partnerId === null && <label className="admin-checkbox"><input type="checkbox" checked={saveAsPartner} onChange={(event) => setSaveAsPartner(event.target.checked)} /> Salvează clientul ca partener la emiterea documentului</label>}
          </section>

          <section className="document-block"><h3>Condiții</h3>
            <div className="partner-billing-grid">
              <label>Discount general (%)<input inputMode="decimal" value={discount} disabled={!editable} onChange={(event) => setDiscount(event.target.value)} /></label>
              <label>Valabilitate (zile)<input inputMode="numeric" value={validity} disabled={!editable} onChange={(event) => setValidity(event.target.value.replace(/\D/g, ""))} /></label>
            </div>
            <label className="notes-label">Mențiuni pe document<textarea className="note-field" value={notes} disabled={!editable} maxLength={2000} rows={3} onChange={(event) => setNotes(event.target.value)} placeholder="ex. livrare în 3 zile lucrătoare, plata prin OP" /></label>
          </section>
        </div>

        <section className="document-block"><div className="section-line"><h3>Produse</h3><span>{lines.length} {lines.length === 1 ? "produs" : "produse"}</span></div>
          {editable && picked.size > 0 && <div className="selection-bar line-selection">
            <strong>{picked.size} {picked.size === 1 ? "produs selectat" : "produse selectate"}</strong>
            <form className="selection-group" onSubmit={(event) => { event.preventDefault(); if (bulkDiscount.trim()) { setLineDiscount(picked, cleanPercent(bulkDiscount)); setPicked(new Set()); setBulkDiscount(""); } }}>
              <label className="inline-percent">Discount<input inputMode="decimal" value={bulkDiscount} onChange={(event) => setBulkDiscount(event.target.value)} placeholder={String(discountValue)} aria-label="Discount pentru produsele selectate" />%</label>
              <button type="submit" className="button button-primary" disabled={!bulkDiscount.trim()}>Aplică</button>
            </form>
            <button type="button" className="button button-outline" onClick={() => { setLineDiscount(picked, ""); setPicked(new Set()); }}>Revino la discountul general</button>
            <button type="button" className="text-button" onClick={() => setPicked(new Set())}>Deselectează</button>
          </div>}
          <div className="handed-table-wrap"><table className="handed-table document-lines">
            <thead><tr>
              {editable && <th className="check-cell"><input type="checkbox" checked={lines.length > 0 && lines.every((line) => picked.has(line.productId))}
                onChange={(event) => setPicked(event.target.checked ? new Set(lines.map((line) => line.productId)) : new Set())} aria-label="Selectează toate produsele" /></th>}
              <th>Produs</th><th>Cantitate</th><th>Preț listă</th><th>Discount</th><th>Preț final</th><th>TVA</th><th>Valoare</th>{editable && <th><span className="sr-only">Scoate</span></th>}
            </tr></thead>
            <tbody>{lines.map((line, index) => {
              const lineDiscount = lineDiscountOf(line);
              const finalPrice = line.unitPrice * (1 - lineDiscount / 100);
              const custom = line.discount !== "";
              return (
                <tr key={line.productId} className={`${custom ? "custom-discount" : ""} ${picked.has(line.productId) ? "selected" : ""}`}>
                  {editable && <td className="check-cell"><input type="checkbox" checked={picked.has(line.productId)} onChange={() => togglePicked(line.productId)} aria-label={`Selectează ${line.name}`} /></td>}
                  <td><span className="strong">{line.name}</span><small>SKU {line.sku}</small></td>
                  <td>{editable ? <input className="request-qty" inputMode="numeric" value={line.quantity} onChange={(event) => setLines(lines.map((item, i) => i === index ? { ...item, quantity: event.target.value.replace(/\D/g, "") } : item))} aria-label={`Cantitate ${line.name}`} /> : line.quantity}</td>
                  <td className="nowrap">{formatMoney(line.unitPrice)} lei</td>
                  <td className="nowrap">{editable
                    ? <span className="line-discount"><input inputMode="decimal" value={line.discount} placeholder={String(discountValue)}
                        onChange={(event) => setLineDiscount(new Set([line.productId]), cleanPercent(event.target.value))} aria-label={`Discount ${line.name}`} />%
                      {custom && <button type="button" className="text-button reset-discount" title={`Revino la discountul general (${discountValue}%)`} aria-label={`Revino la discountul general pentru ${line.name}`}
                        onClick={() => setLineDiscount(new Set([line.productId]), "")}>↺</button>}</span>
                    : <span className={custom ? "discount-chip custom" : "discount-chip"}>{lineDiscount > 0 ? `−${lineDiscount}%` : "—"}</span>}</td>
                  <td className="nowrap">{formatMoney(finalPrice)} lei</td>
                  <td className="nowrap">{line.vatPercent}%</td>
                  <td className="nowrap strong">{formatMoney((Number(line.quantity) || 0) * finalPrice)} lei</td>
                  {editable && <td><button type="button" className="remove-button" title="Scoate" aria-label={`Scoate ${line.name}`} onClick={() => setLines(lines.filter((_, i) => i !== index))}><svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M7 7l10 10M17 7 7 17" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"/></svg></button></td>}
                </tr>
              );
            })}</tbody>
          </table></div>
          {editable && lines.length > 0 && <p className="muted small line-discount-hint">Discountul general ({discountValue}%) se aplică tuturor produselor. Scrie alt procent pe un rând, sau bifează mai multe rânduri, ca să le dai alt discount.{customLines > 0 ? ` ${customLines} ${customLines === 1 ? "produs are" : "produse au"} discount propriu.` : ""}</p>}
          {editable && collections.length > 0 && <div className="collection-picker">
            <select className="catalog-select" value={collectionId} onChange={(event) => addCollection(event.target.value)} aria-label="Adaugă din colecție">
              <option value="">Adaugă din colecție…</option>{collections.map((item) => <option key={item.id} value={item.id}>{item.name} ({item.productIds.length})</option>)}</select>
            {lines.length > 0 && <button type="button" className="text-button danger-text" onClick={() => setLines([])}>Golește lista</button>}
          </div>}
          {editable && <div className="product-picker">
            <input className="group-member-search" type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Adaugă produs (nume sau SKU)" aria-label="Adaugă produs" />
            {matches.length > 0 && <div className="group-member-list request-options">{matches.map((item) => (
              <button key={item.id} type="button" className="request-option" onClick={() => { setLines([...lines, { productId: item.id, name: item.name, sku: item.sku, quantity: "1", unitPrice: item.list_price ?? 0, vatPercent: item.vat_percent ?? 21, discount: "" }]); setQuery(""); }}>
                <span>{item.name}</span><small>SKU {item.sku} · {formatMoney(item.list_price ?? 0)} lei</small>
              </button>
            ))}</div>}
          </div>}
          <dl className="document-totals">
            <dt>Total fără TVA</dt><dd>{formatMoney(totals.net)} lei</dd>
            {totals.discount > 0 && <><dt>{customLines > 0 ? "Discounturi" : `Discount ${discountValue}%`}</dt><dd>−{formatMoney(totals.discount)} lei</dd></>}
            <dt>TVA</dt><dd>{formatMoney(totals.vat)} lei</dd>
            <dt className="grand">Total de plată</dt><dd className="grand">{formatMoney(totals.total)} lei</dd>
          </dl>
        </section>

        {document && document.status !== "draft" && <DocumentProgress document={document} related={related} />}
        {document?.status === "draft" && document.bocp_error && <p className="bocp-error document-feedback"><strong>BOCP:</strong> {document.bocp_error}</p>}
        {feedback && <p className={`action-feedback ${feedback.ok ? "success" : "error"} document-feedback`} role="status">{feedback.message}</p>}
        <div className="document-actions">
          <Link className="text-button" href="/account/offers">← Înapoi la listă</Link>
          <span />
          {reopenable && editing && <button type="button" className="text-button" disabled={pending} onClick={onReset}>Renunță la modificări</button>}
          {reopenable && editing && <button type="button" className="button button-primary" disabled={pending || !lines.length || !client.name.trim()} onClick={() => save(false)}>Salvează modificările</button>}
          {reopenable && !editing && <button type="button" className="button button-outline" disabled={pending} onClick={() => setEditing(true)}>Editează oferta</button>}
          {editable && !reopenable && <button type="button" className="button button-outline" disabled={pending || !lines.length || !client.name.trim()} onClick={() => save(false)}>Salvează ciorna</button>}
          {editable && !reopenable && <button type="button" className="button button-primary" disabled={pending || !lines.length || !client.name.trim()} onClick={() => save(true)}>
            {pending && kind === "proforma" ? "Se emite în BOCP…" : kind === "offer" ? "Emite oferta" : "Emite proforma în BOCP"}</button>}
          {document && !editing && <DocumentActions document={document} related={related} pending={pending} act={act} />}
        </div>
      </section>
    </div>
  );
}

const downloadIcon = <svg className="button-icon" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 4v11m0 0-4.5-4.5M12 15l4.5-4.5M5 19h14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>;

function DocumentActions({ document, related, pending, act }: {
  document: EditorDocument; related: RelatedDocument[]; pending: boolean;
  act: (action: () => Promise<{ ok: boolean; message: string; id?: string }>) => void;
}) {
  const [cancelling, setCancelling] = useState(false);
  const [reason, setReason] = useState("");
  const proforma = related.find((item) => item.kind === "proforma" && item.status !== "cancelled");

  if (document.kind === "offer") {
    if (document.status !== "issued") return null;
    return <>
      <a className="button button-outline" href={`/account/offers/${document.id}/print`} target="_blank" rel="noopener noreferrer">{downloadIcon}Descarcă PDF</a>
      {proforma
        ? <Link className="button button-primary" href={`/account/offers/${proforma.id}`}>Vezi proforma {proforma.number ?? "(ciornă)"}</Link>
        : <button type="button" className="button button-primary" disabled={pending} onClick={() => act(() => offerToProforma(document.id))}>Transformă în proformă</button>}
    </>;
  }

  if (document.status === "issuing") {
    return <button type="button" className="button button-primary" disabled={pending} onClick={() => act(() => checkProforma(document.id))}>{pending ? "Verific…" : "Verifică în BOCP"}</button>;
  }
  if (document.status !== "issued" && document.status !== "cancel_requested") return null;

  const invoiceUrl = document.invoiced_at && document.bocp_invoice_id ? `/account/offers/${document.id}/invoice`
    : document.partner_carts?.invoiced_at && document.partner_carts.bocp_invoice_id ? `/billing/invoice/${document.partner_carts.id}` : null;
  const open = document.status === "issued" && !document.cart_id && !document.invoice_requested_at;

  if (cancelling) {
    return <div className="proforma-cancel">
      <label>Motivul anulării (opțional)<input value={reason} maxLength={500} onChange={(event) => setReason(event.target.value)} placeholder="ex. clientul a renunțat" autoFocus /></label>
      <button type="button" className="text-button" onClick={() => setCancelling(false)}>Renunță</button>
      <button type="button" className="button button-danger" disabled={pending} onClick={() => act(() => cancelProforma(document.id, reason))}>{pending ? "Anulez…" : "Anulează proforma"}</button>
    </div>;
  }

  return <>
    <a className="button button-outline" href={`/account/offers/${document.id}/proforma`} target="_blank" rel="noopener noreferrer">{downloadIcon}Proforma (PDF BOCP)</a>
    {invoiceUrl && <a className="button button-outline" href={invoiceUrl} target="_blank" rel="noopener noreferrer">{downloadIcon}Factura</a>}
    {open && <button type="button" className="text-button danger-text" disabled={pending} onClick={() => setCancelling(true)}>Anulează proforma</button>}
    {open && <button type="button" className="button button-outline" disabled={pending} onClick={() => act(() => requestDocumentInvoice(document.id))}
      title="Facturarea emite factura direct, fără pregătire în depozit">Cere factura</button>}
    {open && (document.partner_id
      ? <button type="button" className="button button-primary" disabled={pending} onClick={() => act(() => reserveDocumentOrder(document.id))}
        title="Comanda merge la depozit: raft, apoi facturare">Rezervă comanda</button>
      : <span className="muted small">Pentru „Rezervă comanda”, clientul trebuie să fie partener.</span>)}
  </>;
}

function formatDay(value: string) {
  return new Intl.DateTimeFormat("ro-RO", { day: "2-digit", month: "short", year: "numeric" }).format(new Date(`${value.slice(0, 10)}T12:00:00`));
}

// Where the document is: offer → proforma in BOCP → warehouse and/or billing → invoice.
function DocumentProgress({ document, related }: { document: EditorDocument; related: RelatedDocument[] }) {
  const cart = document.partner_carts;
  const source = related.find((item) => item.id === document.source_document_id);
  const steps: { label: string; detail: string; done: boolean }[] = [];

  if (document.kind === "offer") {
    const proformas = related.filter((item) => item.kind === "proforma");
    steps.push({ label: "Ofertă emisă", detail: document.issued_at ? formatDateTime(document.issued_at) : "—", done: true });
    steps.push({ label: "Proformă", detail: proformas.length ? proformas.map((item) => item.number ?? "ciornă").join(", ") : "Încă nu", done: proformas.some((item) => item.status === "issued") });
  } else {
    if (source) steps.push({ label: "Din oferta", detail: source.number ?? "—", done: true });
    steps.push({ label: "Proformă în BOCP", done: document.status !== "issuing",
      detail: document.status === "issuing" ? "Comanda a ajuns în BOCP, se așteaptă numărul proformei" : `${document.number}${document.bocp_proforma_total !== null ? ` · ${formatMoney(document.bocp_proforma_total)} lei` : ""} · stoc rezervat în BOCP` });
    if (document.status === "cancel_requested" || document.status === "cancelled") {
      steps.push({ label: "Anulare", done: document.status === "cancelled",
        detail: document.status === "cancelled" ? `Anulată în BOCP${document.cancelled_at ? ` · ${formatDateTime(document.cancelled_at)}` : ""}` : "Stoc eliberat · facturarea anulează proforma în BOCP" });
      if (document.cancel_reason) steps.push({ label: "Motiv", detail: document.cancel_reason, done: true });
    } else if (cart) {
      const stage = cart.invoiced_at ? "Facturată" : cart.status === "delivered" ? "La facturare" : cart.prepared_at ? "Pe raft" : "În depozit (de pregătit)";
      steps.push({ label: "Comandă rezervată", detail: stage, done: cart.status === "delivered" });
      steps.push({ label: "Factură", detail: cart.invoice_number ?? "Încă nu", done: !!cart.invoiced_at });
    } else if (document.invoice_requested_at) {
      steps.push({ label: "Cerere de factură", detail: formatDateTime(document.invoice_requested_at), done: true });
      steps.push({ label: "Factură", detail: document.invoice_number ? `${document.invoice_number}${document.invoice_date ? ` · ${formatDay(document.invoice_date)}` : ""}` : "La facturare", done: !!document.invoiced_at });
    } else if (document.status === "issued") {
      steps.push({ label: "Următorul pas", detail: "Rezervă comanda la depozit sau cere factura direct. Le poți face oricând de aici.", done: false });
    }
  }

  return <section className="document-block document-progress"><h3>Parcurs</h3>
    <ol className="progress-steps">{steps.map((step) => <li key={step.label} className={step.done ? "done" : ""}><strong>{step.label}</strong><span>{step.detail}</span></li>)}</ol>
  </section>;
}

// A collection's products as document lines (quantity 1, current list prices), skipping products
// already on the document or without a BOCP price.
function collectionLines(collection: EditorCollection, catalog: EditorProduct[], existing: Line[]): Line[] {
  const byId = new Map(catalog.map((product) => [product.id, product]));
  return collection.productIds.filter((id) => !existing.some((line) => line.productId === id)).flatMap((id) => {
    const product = byId.get(id);
    return product ? [{ productId: product.id, name: product.name, sku: product.sku, quantity: "1", unitPrice: product.list_price ?? 0, vatPercent: product.vat_percent ?? 21, discount: "" }] : [];
  });
}

// A percentage typed by the agent: digits and one decimal separator, below 100.
function cleanPercent(value: string) {
  const cleaned = value.replace(",", ".").replace(/[^\d.]/g, "").replace(/(\..*)\./g, "$1");
  return Number(cleaned) >= 100 ? "99" : cleaned;
}

function percent(value: string) {
  const parsed = Number(value.replace(",", "."));
  return Number.isFinite(parsed) ? Math.min(99.99, Math.max(0, Math.round(parsed * 100) / 100)) : 0;
}
