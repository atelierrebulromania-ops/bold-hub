import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { requireRole } from "@/lib/auth";
import { PaymentChip } from "@/components/payment-chip";
import { formatDueDate } from "@/lib/invoice-status";
import { formatDateTime } from "@/lib/orders";
import { documentTotals, formatMoney } from "@/lib/pricing";
import { LinkPending } from "@/components/link-pending";

export const dynamic = "force-dynamic";

type Row = { status: string; kind: string; cart_id: string | null; invoice_requested_at: string | null; invoiced_at: string | null;
  partner_carts: { status: string; prepared_at: string | null; invoiced_at: string | null } | null };

// One label for where the document is now.
function stage(document: Row): { label: string; tone: "inactive" | "remarks" | "ok" } {
  if (document.status === "draft") return { label: "Ciornă", tone: "inactive" };
  if (document.status === "issuing") return { label: "Se emite în BOCP", tone: "remarks" };
  if (document.status === "cancel_requested") return { label: "Anulare cerută", tone: "remarks" };
  if (document.status === "cancelled") return { label: "Anulată", tone: "inactive" };
  if (document.kind === "offer") return { label: "Emisă", tone: "remarks" };
  const cart = document.partner_carts;
  if (cart?.invoiced_at || document.invoiced_at) return { label: "Facturată", tone: "ok" };
  if (cart) return { label: cart.status === "delivered" ? "La facturare" : cart.prepared_at ? "Pe raft" : "În depozit", tone: "remarks" };
  if (document.invoice_requested_at) return { label: "Factură cerută", tone: "remarks" };
  return { label: "Emisă · stoc rezervat", tone: "remarks" };
}

export default async function AgentDocumentsPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const { supabase, profile } = await requireRole(["admin", "account"]);
  const tab = (await searchParams).tab;
  const view = tab === "proforme" ? "proforma" : tab === "facturi" ? "invoices" : "offer";
  const kind = view === "proforma" ? "proforma" : "offer";
  const invoicesResult = await supabase.rpc("account_invoices");
  const invoices = invoicesResult.data ?? [];
  const { data, error } = await supabase.from("sales_documents")
    .select("id,kind,number,status,client_name,discount_percent,created_at,issued_at,bocp_proforma_total,cart_id,invoice_requested_at,invoiced_at,partner_carts!sales_documents_cart_id_fkey(status,prepared_at,invoiced_at),sales_document_items(quantity,unit_price,vat_percent,discount_percent)")
    .eq("account_id", profile.id).order("created_at", { ascending: false }).limit(300);
  const all = data ?? [];
  const documents = all.filter((document) => document.kind === kind);
  const counts = { offer: all.filter((document) => document.kind === "offer").length, proforma: all.filter((document) => document.kind === "proforma").length };

  return (
    <AppShell profile={profile} active="/account/offers" section="Account" title="Oferte, proforme și facturi"
      note={{ title: "Oferte și proforme", text: "Oferta rămâne în aplicație. Proforma se emite în BOCP; de pe ea rezervi comanda la depozit sau ceri factura, oricând." }}>
      <section className="board-panel" aria-label="Oferte și proforme">
        <div className="panel-tabs-row">
          <h2 className="panel-tabs-title">{view === "invoices" ? "Facturi" : kind === "offer" ? "Oferte" : "Proforme"}</h2>
          <nav className="board-tabs panel-tabs" aria-label="Vedere">
            <Link href="/account/offers" className={view === "offer" ? "active" : ""} aria-current={view === "offer" ? "page" : undefined}>Oferte<span>{counts.offer}</span><LinkPending /></Link>
            <Link href="/account/offers?tab=proforme" className={view === "proforma" ? "active" : ""} aria-current={view === "proforma" ? "page" : undefined}>Proforme<span>{counts.proforma}</span><LinkPending /></Link>
            <Link href="/account/offers?tab=facturi" className={view === "invoices" ? "active" : ""} aria-current={view === "invoices" ? "page" : undefined}>Facturi<span>{invoices.length}</span><LinkPending /></Link>
          </nav>
          <span aria-hidden="true" />
        </div>
        {view === "invoices" ? <InvoicesTable invoices={invoices} failed={!!invoicesResult.error} /> : <>
        <div className="catalog-toolbar">
          <p>{kind === "offer" ? "Ofertele rămân în aplicație; din una emisă faci proforma cu un click." : "Proformele sunt emise în BOCP; de pe ele rezervi comanda sau ceri factura."}</p>
          <div className="agent-heading-actions">
            {kind === "offer"
              ? <Link className="button button-primary" href="/account/offers/new?kind=offer">+ Ofertă nouă<LinkPending /></Link>
              : <Link className="button button-primary" href="/account/offers/new?kind=proforma">+ Proformă nouă<LinkPending /></Link>}
          </div>
        </div>
        {error ? <p className="notice error search-notice" role="alert">Documentele nu pot fi încărcate acum.</p>
          : documents.length === 0 ? <p className="admin-empty-note">{kind === "offer" ? "Nu ai încă oferte." : "Nu ai încă proforme."}</p>
          : <div className="handed-table-wrap"><table className="handed-table">
            <thead><tr><th>Număr</th><th>Client</th><th>Total cu TVA</th><th>Stare</th><th>Data</th></tr></thead>
            <tbody>{documents.map((document) => {
              const totals = documentTotals(document.sales_document_items, document.discount_percent);
              const current = stage(document);
              return (
                <tr key={document.id} className="handed-row">
                  <td className="nowrap strong"><Link className="row-link" href={`/account/offers/${document.id}`}>{document.number ?? "Ciornă"}<LinkPending /></Link></td>
                  <td>{document.client_name}</td>
                  <td className="nowrap">{formatMoney(document.bocp_proforma_total ?? totals.total)} lei</td>
                  <td><span className={`outcome-chip ${current.tone}`}>{current.label}</span></td>
                  <td className="nowrap">{formatDateTime(document.issued_at ?? document.created_at)}</td>
                </tr>
              );
            })}</tbody>
          </table></div>}
        </>}
      </section>
    </AppShell>
  );
}

type Invoice = { source: string; id: string; partner_name: string; invoice_number: string; invoice_date: string; due_date: string | null;
  total: number | null; rest: number | null; proforma_number: string | null };

// The invoices of the agent's clients (warehouse orders and proformas invoiced directly).
function InvoicesTable({ invoices, failed }: { invoices: Invoice[]; failed: boolean }) {
  if (failed) return <p className="notice error search-notice" role="alert">Facturile nu pot fi încărcate acum.</p>;
  if (!invoices.length) return <p className="admin-empty-note">Clienții tăi nu au încă facturi emise.</p>;
  return (
    <div className="handed-table-wrap"><table className="handed-table">
      <thead><tr><th>Factură</th><th>Client</th><th>Emisă</th><th>Total cu TVA</th><th>Scadență</th><th>Din proforma</th><th><span className="sr-only">Descarcă</span></th></tr></thead>
      <tbody>{invoices.map((invoice) => (
        <tr key={`${invoice.source}-${invoice.id}`}>
          <td className="nowrap strong">{invoice.invoice_number}</td>
          <td>{invoice.partner_name}</td>
          <td className="nowrap">{formatDueDate(invoice.invoice_date)}</td>
          <td className="nowrap">{invoice.total !== null ? `${formatMoney(invoice.total)} lei` : "—"}</td>
          <td className="nowrap"><PaymentChip dueDate={invoice.due_date} rest={invoice.rest} /></td>
          <td className="nowrap">{invoice.proforma_number ?? "—"}</td>
          <td className="nowrap"><a className="text-button" href={invoice.source === "document" ? `/account/offers/${invoice.id}/invoice` : `/billing/invoice/${invoice.id}`}
            target="_blank" rel="noopener noreferrer">Descarcă</a></td>
        </tr>
      ))}</tbody>
    </table></div>
  );
}
