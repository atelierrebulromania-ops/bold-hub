import { redirect } from "next/navigation";
import { requireRole } from "@/lib/auth";
import { findBocpInvoice } from "@/lib/bocp/invoice-lookup";

export const dynamic = "force-dynamic";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Opens the invoice billing issued for a proforma. A fresh PDF link is read from BOCP; the stored
// one is the fallback when BOCP cannot be reached.
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase } = await requireRole(["admin", "account", "operator_facturare"]);
  if (!uuid.test(id)) return new Response("Documentul nu este valid.", { status: 400 });
  const { data: document } = await supabase.from("sales_documents")
    .select("bocp_invoice_id,invoice_date,invoice_pdf_url").eq("id", id).maybeSingle();
  if (!document?.bocp_invoice_id || !document.invoice_date) return new Response("Proforma nu are o factură asociată.", { status: 404 });
  let url = document.invoice_pdf_url;
  try {
    const fresh = await findBocpInvoice("", document.invoice_date, document.bocp_invoice_id);
    if (fresh?.pdfUrl) url = fresh.pdfUrl;
  } catch { /* BOCP unreachable from here: use the stored link. */ }
  if (!url) return new Response("Factura nu are un PDF disponibil în BOCP.", { status: 404 });
  redirect(url);
}
