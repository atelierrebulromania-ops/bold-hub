import { redirect } from "next/navigation";
import { requirePartner } from "@/lib/auth";
import { findBocpInvoice } from "@/lib/bocp/invoice-lookup";

export const dynamic = "force-dynamic";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Opens one of the location's invoices (a B2B cart or a proforma invoiced directly). A fresh PDF
// link is read from BOCP; the stored one is the fallback when BOCP cannot be reached.
export async function GET(_request: Request, { params }: { params: Promise<{ source: string; id: string }> }) {
  const { source, id } = await params;
  const { supabase, partner } = await requirePartner();
  if (!["cart", "document"].includes(source) || !uuid.test(id)) return new Response("Factura nu este validă.", { status: 400 });
  const { data } = await supabase.rpc("partner_invoices", { p_partner_id: partner.id });
  const invoice = (data ?? []).find((row) => row.source === source && row.id === id);
  if (!invoice) return new Response("Factura nu a fost găsită.", { status: 404 });
  let url = invoice.invoice_pdf_url;
  try {
    const fresh = await findBocpInvoice("", invoice.invoice_date, invoice.bocp_invoice_id);
    if (fresh?.pdfUrl) url = fresh.pdfUrl;
  } catch { /* BOCP unreachable from here: use the stored link. */ }
  if (!url) return new Response("Factura nu are un PDF disponibil în BOCP.", { status: 404 });
  redirect(url);
}
