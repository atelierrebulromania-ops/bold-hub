"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { lookupCompanyByCui, savePartnerBilling, searchBocpContacts, type BocpContactMatch, type PartnerBilling } from "./actions";

// Billing data of a partner: the client its BOCP orders (stock reservations) are placed on.
export function PartnerBillingEditor({ partnerId, initial }: { partnerId: string; initial: PartnerBilling }) {
  const router = useRouter();
  const [billing, setBilling] = useState<PartnerBilling>(initial);
  const [query, setQuery] = useState("");
  const [matches, setMatches] = useState<BocpContactMatch[] | null>(null);
  const [feedback, setFeedback] = useState<{ ok: boolean; message: string } | null>(null);
  const [searching, startSearch] = useTransition();
  const [saving, startSave] = useTransition();

  const complete = !!(billing.vatId.trim() && billing.billingName.trim() && billing.street.trim() && billing.city.trim() && billing.county.trim());
  const [anafLoading, startAnaf] = useTransition();

  function fromAnaf() {
    setFeedback(null);
    startAnaf(async () => {
      const result = await lookupCompanyByCui(billing.vatId);
      if (result.billing) setBilling({ ...billing, ...result.billing });
      setFeedback({ ok: result.ok, message: result.message });
    });
  }
  const set = (key: keyof PartnerBilling, value: string) => setBilling({ ...billing, [key]: value });

  function search() {
    setFeedback(null);
    startSearch(async () => {
      const result = await searchBocpContacts(query);
      setMatches(result.contacts);
      if (!result.ok) setFeedback({ ok: false, message: result.message ?? "Căutarea nu a reușit." });
      else if (!result.contacts.length) setFeedback({ ok: false, message: "Niciun client BOCP găsit. Completează datele manual; clientul se creează în BOCP la prima comandă." });
    });
  }

  function pick(contact: BocpContactMatch) {
    setBilling({ bocpContactId: contact.bocpContactId, billingName: contact.billingName, vatId: contact.vatId, registrationNumber: contact.registrationNumber,
      street: contact.street, city: contact.city, county: contact.county, zip: contact.zip });
    setMatches(null);
    setFeedback({ ok: true, message: `Date preluate de la clientul BOCP #${contact.bocpContactId}${contact.pricelist ? ` (listă de prețuri: ${contact.pricelist})` : ""}. Salvează.` });
  }

  function save() {
    startSave(async () => {
      const result = await savePartnerBilling(partnerId, billing);
      setFeedback(result);
      if (result.ok) router.refresh();
    });
  }

  return (
    <details className="partner-billing">
      <summary>
        <span>Date de facturare</span>
        <span className={`partner-tag ${complete ? "linked" : "important"}`}>{billing.bocpContactId ? `Client BOCP #${billing.bocpContactId}` : complete ? "Complete" : "Incomplete"}</span>
      </summary>
      <div className="partner-billing-body">
        <div className="admin-inline admin-mini-form">
          <input value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); search(); } }}
            placeholder="Caută clientul în BOCP (nume sau CUI)" aria-label="Caută clientul în BOCP" />
          <button type="button" className="button button-outline" disabled={searching || query.trim().length < 3} onClick={search}>{searching ? "Caut…" : "Caută în BOCP"}</button>
        </div>
        {matches && matches.length > 0 && <ul className="bocp-matches">{matches.map((contact) => (
          <li key={contact.bocpContactId}><button type="button" onClick={() => pick(contact)}>
            <strong>{contact.billingName}</strong><small>{[contact.vatId && `CUI ${contact.vatId}`, contact.city, contact.county].filter(Boolean).join(" · ") || "fără date"}</small>
          </button></li>
        ))}</ul>}
        <div className="cui-lookup">
          <label>CUI <span className="required">obligatoriu</span>
            <input value={billing.vatId} maxLength={20} onChange={(event) => set("vatId", event.target.value)}
              onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); fromAnaf(); } }} placeholder="ex. RO42910222" />
          </label>
          <button type="button" className="button button-outline" disabled={anafLoading || billing.vatId.trim().length < 2} onClick={fromAnaf}>{anafLoading ? "Caut la ANAF…" : "Completează din ANAF"}</button>
        </div>
        <div className="partner-billing-grid">
          <label>Denumire firmă<input value={billing.billingName} maxLength={200} onChange={(event) => set("billingName", event.target.value)} /></label>
          <label>Nr. Reg. Com.<input value={billing.registrationNumber} maxLength={40} onChange={(event) => set("registrationNumber", event.target.value)} /></label>
          <label>Stradă și număr<input value={billing.street} maxLength={200} onChange={(event) => set("street", event.target.value)} /></label>
          <label>Oraș<input value={billing.city} maxLength={80} onChange={(event) => set("city", event.target.value)} /></label>
          <label>Județ<input value={billing.county} maxLength={80} onChange={(event) => set("county", event.target.value)} /></label>
          <label>Cod poștal<input value={billing.zip} maxLength={12} onChange={(event) => set("zip", event.target.value)} /></label>
        </div>
        <div className="partner-billing-actions">
          {billing.bocpContactId && <button type="button" className="text-button" onClick={() => setBilling({ ...billing, bocpContactId: null })}>Dezleagă de clientul BOCP</button>}
          <button type="button" className="button button-primary" disabled={saving || !complete} title={complete ? undefined : "Completează CUI, denumirea și adresa"} onClick={save}>Salvează datele de facturare</button>
        </div>
        {feedback && <p className={`action-feedback ${feedback.ok ? "success" : "error"}`} role="status">{feedback.message}</p>}
      </div>
    </details>
  );
}
