import { notFound } from "next/navigation";
import { requireRole } from "@/lib/auth";
import { company } from "@/lib/company";
import { documentTotals, formatMoney, lineDiscount, money } from "@/lib/pricing";
import { PrintButton } from "./print-button";

export const dynamic = "force-dynamic";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function day(value: Date) {
  return new Intl.DateTimeFormat("ro-RO", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "Europe/Bucharest" }).format(value);
}

export default async function PrintDocumentPage({ params }: { params: Promise<{ id: string }> }) {
  const { supabase, profile } = await requireRole(["admin", "account"]);
  const { id } = await params;
  if (!uuid.test(id)) notFound();
  const { data: document } = await supabase.from("sales_documents")
    .select("kind,number,status,client_name,client_vat_id,client_registration,client_street,client_city,client_county,client_zip,contact_name,contact_email,contact_phone,discount_percent,validity_days,notes,issued_at,created_at,app_users!sales_documents_account_id_fkey(full_name),sales_document_items(sku,name,quantity,unit_price,vat_percent,discount_percent,position)")
    .eq("id", id).maybeSingle();
  // Proformas are printed from BOCP (their own document); this page is the offer's PDF.
  if (!document || document.status === "draft" || document.kind !== "offer") notFound();

  const items = [...document.sales_document_items].sort((a, b) => a.position - b.position);
  const totals = documentTotals(items, document.discount_percent);
  const issued = new Date(document.issued_at ?? document.created_at);
  const validUntil = new Date(issued.getTime() + document.validity_days * 86_400_000);
  const discountOf = (item: (typeof items)[number]) => lineDiscount(item, document.discount_percent);
  const anyDiscount = items.some((item) => discountOf(item) > 0);
  const mixed = new Set(items.map(discountOf)).size > 1;
  const isOffer = document.kind === "offer";
  const agent = document.app_users?.full_name ?? profile.full_name;

  return (
    <main className="print-page">
      <div className="print-toolbar print-hide"><span>{isOffer ? "Ofertă" : "Proformă"} {document.number}</span><PrintButton /></div>
      <article className="print-doc">
        <header className="print-header">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={company.logo} alt={company.brand} className="print-logo" />
          <div className="print-title">
            <h1>{isOffer ? "Ofertă de preț" : "Factură proformă"}</h1>
            <p>Nr. <strong>{document.number}</strong> din {day(issued)}</p>
            <p>Valabilă până la <strong>{day(validUntil)}</strong></p>
          </div>
        </header>

        <section className="print-parties">
          <div>
            <h2>Furnizor</h2>
            <p className="strong">{company.name}</p>
            <p>CUI {company.vatId} · {company.registrationNumber}</p>
            <p>{company.address}</p>
            <p>{company.website}</p>
          </div>
          <div>
            <h2>Client</h2>
            <p className="strong">{document.client_name}</p>
            {(document.client_vat_id || document.client_registration) && <p>{[document.client_vat_id && `CUI ${document.client_vat_id}`, document.client_registration].filter(Boolean).join(" · ")}</p>}
            {(document.client_street || document.client_city) && <p>{[document.client_street, document.client_city, document.client_county, document.client_zip].filter(Boolean).join(", ")}</p>}
            {(document.contact_name || document.contact_phone || document.contact_email) && <p>{[document.contact_name, document.contact_phone, document.contact_email].filter(Boolean).join(" · ")}</p>}
          </div>
        </section>

        <table className="print-table">
          <thead><tr><th>#</th><th>Produs</th><th>Cant.</th><th>Preț listă</th>{anyDiscount && <th>Discount</th>}<th>Preț unitar</th><th>TVA</th><th>Valoare fără TVA</th></tr></thead>
          <tbody>{items.map((item, index) => (
            <tr key={`${item.sku}-${index}`}>
              <td>{index + 1}</td>
              <td><span className="strong">{item.name}</span><small>{item.sku}</small></td>
              <td>{item.quantity}</td>
              <td>{formatMoney(item.unit_price)}</td>
              {anyDiscount && <td>{discountOf(item) > 0 ? `${discountOf(item)}%` : "—"}</td>}
              <td>{formatMoney(money(item.unit_price * (1 - discountOf(item) / 100)))}</td>
              <td>{item.vat_percent}%</td>
              <td className="strong">{formatMoney(money(item.unit_price * (1 - discountOf(item) / 100) * item.quantity))}</td>
            </tr>
          ))}</tbody>
        </table>

        <div className="print-summary">
          <div className="print-notes">
            {document.notes && <><h2>Mențiuni</h2><p>{document.notes}</p></>}
            <p className="muted">Prețurile sunt exprimate în lei. {isOffer ? "Oferta nu reprezintă o factură." : "Proforma nu este document fiscal."}</p>
          </div>
          <dl>
            <dt>Total listă fără TVA</dt><dd>{formatMoney(totals.net)} lei</dd>
            {totals.discount > 0 && <><dt>{mixed ? "Discounturi" : `Discount ${discountOf(items[0])}%`}</dt><dd>−{formatMoney(totals.discount)} lei</dd></>}
            <dt>Total fără TVA</dt><dd>{formatMoney(totals.subtotal)} lei</dd>
            <dt>TVA</dt><dd>{formatMoney(totals.vat)} lei</dd>
            <dt className="grand">Total de plată</dt><dd className="grand">{formatMoney(totals.total)} lei</dd>
          </dl>
        </div>

        <footer className="print-footer">
          <p>Întocmit de <strong>{agent}</strong>, {company.brand}</p>
          <p>{company.name} · {company.website}</p>
        </footer>
      </article>
    </main>
  );
}
