import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { requireRole } from "@/lib/auth";
import { formatDateTime } from "@/lib/orders";
import { documentTotals, formatMoney } from "@/lib/pricing";

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

export default async function AgentDocumentsPage() {
  const { supabase, profile } = await requireRole(["admin", "account"]);
  const { data, error } = await supabase.from("sales_documents")
    .select("id,kind,number,status,client_name,discount_percent,created_at,issued_at,bocp_proforma_total,cart_id,invoice_requested_at,invoiced_at,partner_carts!sales_documents_cart_id_fkey(status,prepared_at,invoiced_at),sales_document_items(quantity,unit_price,vat_percent,discount_percent)")
    .eq("account_id", profile.id).order("created_at", { ascending: false }).limit(300);
  const documents = data ?? [];

  return (
    <AppShell profile={profile} active="/account/offers" section="Account" title="Oferte și proforme"
      note={{ title: "Oferte și proforme", text: "Oferta rămâne în aplicație. Proforma se emite în BOCP; de pe ea rezervi comanda la depozit sau ceri factura, oricând." }}>
      <section className="board-panel" aria-label="Oferte și proforme">
        <div className="board-panel-heading">
          <div><h2>Oferte și proforme</h2><p>{documents.length} {documents.length === 1 ? "document" : "documente"}.</p></div>
          <div className="agent-heading-actions">
            <Link className="button button-outline" href="/account/offers/new?kind=proforma">+ Proformă nouă</Link>
            <Link className="button button-primary" href="/account/offers/new?kind=offer">+ Ofertă nouă</Link>
          </div>
        </div>
        {error ? <p className="notice error search-notice" role="alert">Documentele nu pot fi încărcate acum.</p>
          : documents.length === 0 ? <p className="admin-empty-note">Nu ai încă oferte sau proforme.</p>
          : <div className="handed-table-wrap"><table className="handed-table">
            <thead><tr><th>Număr</th><th>Tip</th><th>Client</th><th>Total cu TVA</th><th>Stare</th><th>Data</th></tr></thead>
            <tbody>{documents.map((document) => {
              const totals = documentTotals(document.sales_document_items, document.discount_percent);
              const current = stage(document);
              return (
                <tr key={document.id} className="handed-row">
                  <td className="nowrap strong"><Link className="row-link" href={`/account/offers/${document.id}`}>{document.number ?? "Ciornă"}</Link></td>
                  <td>{document.kind === "offer" ? "Ofertă" : "Proformă"}</td>
                  <td>{document.client_name}</td>
                  <td className="nowrap">{formatMoney(document.bocp_proforma_total ?? totals.total)} lei</td>
                  <td><span className={`outcome-chip ${current.tone}`}>{current.label}</span></td>
                  <td className="nowrap">{formatDateTime(document.issued_at ?? document.created_at)}</td>
                </tr>
              );
            })}</tbody>
          </table></div>}
      </section>
    </AppShell>
  );
}
