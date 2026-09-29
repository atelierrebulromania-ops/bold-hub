import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { requireRole } from "@/lib/auth";
import { bocpProductStock } from "@/lib/b2b-bocp";
import { BillingBoard, type BillingCart, type BillingView, type BocpReserved } from "./billing-board";
import { DocumentRequests, type BillingDocument } from "./document-requests";

export const dynamic = "force-dynamic";

const fields = "id,prepared_at,delivered_at,delivered_by,reserved_in_bocp_at,reserved_in_bocp_by,bocp_order_id,bocp_order_error,bocp_order_attempted_at,invoiced_at,invoiced_by,invoice_number,invoice_date,bocp_invoice_id,partners(business_name,location_name,type,is_important_client,contact_phone,contact_email,partner_discounts(category,percent)),sales_documents!partner_carts_source_document_id_fkey(kind,number,discount_percent,sales_document_items(sku,discount_percent)),partner_cart_items(id,quantity_needed,products(name,sku,variant_label,category))" as const;

const documentFields = "id,number,client_name,client_vat_id,discount_percent,account_id,bocp_order_id,bocp_proforma_total,invoice_requested_at,invoiced_at,invoiced_by,invoice_number,bocp_invoice_id,cancel_requested_at,cancel_reason,status,sales_document_items(sku,name,quantity,unit_price,vat_percent,discount_percent,position)" as const;

const tabs: { view: BillingView; label: string; title: string }[] = [
  { view: "reserve", label: "Rezervare", title: "Rezervare în BOCP" },
  { view: "invoice", label: "Facturare", title: "Facturare" },
  { view: "products", label: "Status", title: "Status rezervări BOCP" },
  { view: "history", label: "Istoric", title: "Istoric" },
];

export default async function BillingPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const { supabase, profile } = await requireRole(["admin", "operator_facturare"]);
  const requested = (await searchParams).tab;
  const view: BillingView = tabs.some((tab) => tab.view === requested) ? requested as BillingView : "reserve";

  const [reserveResult, invoiceResult, productsResult, historyResult, staffResult, docInvoiceResult, docCancelResult, docHistoryResult] = await Promise.all([
    // On the shelf, but the BOCP order that reserves the stock is not in place yet.
    supabase.from("partner_carts").select(fields).in("status", ["prepared", "delivered"])
      .not("prepared_at", "is", null).is("reserved_in_bocp_at", null).order("prepared_at", { ascending: true }).limit(300),
    // Sent with "Predare - Facturare", not yet invoiced.
    supabase.from("partner_carts").select(fields).eq("status", "delivered").is("invoiced_at", null)
      .order("delivered_at", { ascending: true }).limit(300),
    // Reserved in BOCP and not yet invoiced.
    view === "products"
      ? supabase.from("partner_carts").select(fields).not("reserved_in_bocp_at", "is", null).is("invoiced_at", null).limit(500)
      : Promise.resolve(null),
    view === "history"
      ? supabase.from("partner_carts").select(fields).eq("status", "delivered").not("invoiced_at", "is", null)
        .order("invoiced_at", { ascending: false }).limit(200)
      : Promise.resolve(null),
    supabase.rpc("staff_names"),
    // Proformas billed without the warehouse, and proformas to cancel in BOCP.
    supabase.from("sales_documents").select(documentFields).eq("status", "issued").not("invoice_requested_at", "is", null)
      .is("invoiced_at", null).order("invoice_requested_at", { ascending: true }).limit(200),
    supabase.from("sales_documents").select(documentFields).eq("status", "cancel_requested").order("cancel_requested_at", { ascending: true }).limit(200),
    view === "history"
      ? supabase.from("sales_documents").select(documentFields).not("invoiced_at", "is", null).order("invoiced_at", { ascending: false }).limit(200)
      : Promise.resolve(null),
  ]);
  const docsToInvoice: BillingDocument[] = docInvoiceResult.data ?? [];
  const docsToCancel: BillingDocument[] = docCancelResult.data ?? [];
  const docsHistory: BillingDocument[] = docHistoryResult?.data ?? [];
  const toReserve: BillingCart[] = reserveResult.data ?? [];
  const toInvoice: BillingCart[] = invoiceResult.data ?? [];
  const carts: BillingCart[] = view === "reserve" ? toReserve : view === "invoice" ? toInvoice
    : view === "products" ? productsResult?.data ?? [] : historyResult?.data ?? [];
  const names = Object.fromEntries((staffResult.data ?? []).map((user) => [user.id, user.full_name]));
  const error = reserveResult.error ?? invoiceResult.error ?? productsResult?.error ?? historyResult?.error;
  const counts: Partial<Record<BillingView, number>> = { reserve: toReserve.length, invoice: toInvoice.length + docsToInvoice.length + docsToCancel.length };

  // "Status" shows BOCP's own reserved stock next to what the B2B carts hold.
  let bocpReserved: BocpReserved | null = null;
  let bocpError: string | null = null;
  if (view === "products" && carts.length) {
    const codes = new Set(carts.flatMap((cart) => cart.partner_cart_items.map((item) => item.products?.sku).filter((sku): sku is string => !!sku)));
    try {
      const stock = await bocpProductStock(codes);
      bocpReserved = Object.fromEntries([...stock.entries()].map(([code, row]) => [code, { reserved: row.reserved, available: row.available }]));
    } catch {
      bocpError = "Stocul din BOCP nu poate fi citit acum (funcționează doar de pe rețeaua permisă în BOCP).";
    }
  }

  return (
    <AppShell profile={profile} active="/billing" section="Operațiuni" title="Facturare B2B"
      note={{ title: "Facturare B2B", text: "La punerea pe raft, aplicația creează comanda în BOCP și rezervă stocul. Factura se emite în BOCP din comanda respectivă." }}>
      {error && <p className="notice error admin-feedback" role="alert">Comenzile nu pot fi încărcate acum. Reîncarcă pagina.</p>}
      <section className="board-panel" aria-label="Facturare B2B">
        <div className="panel-tabs-row">
          <h2 className="panel-tabs-title">{tabs.find((tab) => tab.view === view)?.title}</h2>
          <nav className="board-tabs panel-tabs" aria-label="Vedere">
            {tabs.map((tab) => <Link key={tab.view} href={tab.view === "reserve" ? "/billing" : `/billing?tab=${tab.view}`}
              className={view === tab.view ? "active" : ""} aria-current={view === tab.view ? "page" : undefined}>
              {tab.label}{counts[tab.view] !== undefined && <span>{counts[tab.view]}</span>}</Link>)}
          </nav>
          <span aria-hidden="true" />
        </div>
        {(view === "invoice" || view === "history") && <DocumentRequests toInvoice={docsToInvoice} toCancel={docsToCancel} history={docsHistory} view={view}
          canInvoice={profile.role === "admin" || profile.role === "operator_facturare"} names={names} />}
        {view === "invoice" && docsToInvoice.length + docsToCancel.length > 0 && toInvoice.length > 0 && <h3 className="board-subtitle panel-subtitle">Comenzi B2B predate de depozit</h3>}
        <BillingBoard hideEmpty={(view === "invoice" && docsToInvoice.length + docsToCancel.length > 0) || (view === "history" && docsHistory.length > 0)} carts={carts} view={view} canInvoice={profile.role === "admin" || profile.role === "operator_facturare"} operatorNames={names} bocpReserved={bocpReserved} bocpError={bocpError} />
      </section>
    </AppShell>
  );
}
