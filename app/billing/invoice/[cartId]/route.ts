import { redirect } from "next/navigation";
import { requireRole } from "@/lib/auth";
import { findBocpInvoice } from "@/lib/bocp/invoice-lookup";

export const dynamic = "force-dynamic";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Opens the invoice PDF of an invoiced B2B cart. BOCP PDF links expire, so a fresh one is
// fetched from BOCP; the stored link is the fallback when BOCP cannot be reached.
export async function GET(_request: Request, { params }: { params: Promise<{ cartId: string }> }) {
  const { cartId } = await params;
  // Agents open the invoices of their own clients (row security limits the carts they can read).
  const { supabase } = await requireRole(["admin", "operator_facturare", "account"]);
  if (!uuid.test(cartId)) return new Response("Comanda nu este validă.", { status: 400 });
  const { data: cart } = await supabase.from("partner_carts")
    .select("bocp_invoice_id,invoice_date,invoice_pdf_url").eq("id", cartId).maybeSingle();
  if (!cart?.bocp_invoice_id || !cart.invoice_date) return new Response("Comanda nu are o factură asociată.", { status: 404 });

  let url = cart.invoice_pdf_url;
  try {
    const fresh = await findBocpInvoice("", cart.invoice_date, cart.bocp_invoice_id);
    if (fresh?.pdfUrl) url = fresh.pdfUrl;
  } catch { /* BOCP unreachable from here: use the stored link. */ }
  if (!url) return new Response("Factura nu are un PDF disponibil în BOCP.", { status: 404 });
  redirect(url);
}
