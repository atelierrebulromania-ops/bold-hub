"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth";
import { reserveCartInBocp } from "@/lib/b2b-bocp";
import { findBocpInvoice, type BocpInvoiceMatch } from "@/lib/bocp/invoice-lookup";
import { recordInvoicePayment } from "@/lib/invoice-payments";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Lookup = { ok: true; invoice: BocpInvoiceMatch; warning: string | null } | { ok: false; message: string };

// Invoices for a cart are issued after the warehouse hands it over; a week back covers
// an invoice made a little earlier.
function searchFrom(deliveredAt: string | null) {
  const date = new Date(deliveredAt ?? Date.now());
  date.setDate(date.getDate() - 7);
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Bucharest" }).format(date);
}

async function lookup(cartId: string, invoiceNumber: string): Promise<Lookup> {
  if (!uuid.test(cartId)) return { ok: false, message: "Comanda nu este validă." };
  const number = invoiceNumber.trim();
  if (!number || number.length > 60) return { ok: false, message: "Introdu numărul facturii din BOCP." };
  const { supabase } = await requireRole(["admin", "operator_facturare"]);
  const { data: cart } = await supabase.from("partner_carts")
    .select("id,status,delivered_at,invoiced_at").eq("id", cartId).maybeSingle();
  if (!cart || cart.status !== "delivered" || cart.invoiced_at) return { ok: false, message: "Comanda nu mai așteaptă factura. Reîncarcă pagina." };

  let invoice: BocpInvoiceMatch | null;
  try {
    invoice = await findBocpInvoice(number, searchFrom(cart.delivered_at));
  } catch {
    return { ok: false, message: "BOCP nu a răspuns. Căutarea funcționează doar de pe rețeaua permisă în BOCP; încearcă din nou." };
  }
  if (!invoice) return { ok: false, message: `Nu am găsit factura „${number}” în BOCP. Verifică numărul (seria și numărul, ex. B2BREB-596).` };
  if (invoice.cancelled) return { ok: false, message: `Factura ${invoice.number} este anulată în BOCP.` };

  const { data: other } = await supabase.from("partner_carts").select("id,partners(business_name)")
    .eq("bocp_invoice_id", invoice.bocpInvoiceId).neq("id", cartId).limit(1).maybeSingle();
  const warning = other ? `Atenție: factura este deja asociată comenzii pentru ${other.partners?.business_name ?? "alt partener"}.` : null;
  return { ok: true, invoice, warning };
}

// Retries the BOCP reservation of a cart on the shelf (the order is created when the warehouse
// marks the cart prepared; this runs again after a failure, e.g. missing billing data).
export async function retryCartReservation(cartId: string): Promise<{ ok: boolean; message: string }> {
  if (!uuid.test(cartId)) return { ok: false, message: "Comanda nu este validă." };
  const { supabase } = await requireRole(["admin", "operator_facturare"]);
  const result = await reserveCartInBocp(supabase, cartId);
  revalidatePath("/billing");
  revalidatePath("/partners");
  return result;
}

export async function findCartInvoice(cartId: string, invoiceNumber: string): Promise<Lookup> {
  return lookup(cartId, invoiceNumber);
}

// Several handed carts of the same partner, invoiced with one BOCP invoice. The invoice is looked up
// against the oldest cart; payments and totals are kept on that one.
export async function markCartsInvoiced(cartIds: string[], invoiceNumber: string): Promise<{ ok: boolean; message: string }> {
  if (cartIds.length === 0 || cartIds.length > 20 || !cartIds.every((id) => uuid.test(id))) return { ok: false, message: "Comenzile nu sunt valide." };
  const found = await lookup(cartIds[0], invoiceNumber);
  if (!found.ok) return found;
  const { supabase } = await requireRole(["admin", "operator_facturare"]);
  const { invoice } = found;
  const { data, error } = await supabase.rpc("mark_partner_carts_invoiced", {
    p_cart_ids: cartIds, p_invoice_number: invoice.number, p_bocp_invoice_id: invoice.bocpInvoiceId, p_invoice_date: invoice.date, p_invoice_pdf_url: invoice.pdfUrl,
  });
  if (error) return { ok: false, message: "Nu am putut salva. Încearcă din nou." };
  if (!data) return { ok: false, message: "Comenzile s-au schimbat între timp. Reîncarcă pagina." };
  await recordInvoicePayment(supabase, "cart", data, invoice);
  revalidatePath("/billing");
  return { ok: true, message: cartIds.length > 1
    ? `${cartIds.length} comenzi au fost marcate facturate într-o singură factură (${invoice.number}).`
    : `Comanda a fost marcată ca facturată (${invoice.number}).` };
}

// Proformas sent to billing without the warehouse ("Cere factura").
async function documentLookup(documentId: string, invoiceNumber: string): Promise<Lookup> {
  if (!uuid.test(documentId)) return { ok: false, message: "Documentul nu este valid." };
  const number = invoiceNumber.trim();
  if (!number || number.length > 60) return { ok: false, message: "Introdu numărul facturii din BOCP." };
  const { supabase } = await requireRole(["admin", "operator_facturare"]);
  const { data: document } = await supabase.from("sales_documents")
    .select("id,status,invoice_requested_at,invoiced_at").eq("id", documentId).maybeSingle();
  if (!document || document.status !== "issued" || !document.invoice_requested_at || document.invoiced_at) {
    return { ok: false, message: "Proforma nu mai așteaptă factura. Reîncarcă pagina." };
  }
  let invoice: BocpInvoiceMatch | null;
  try {
    invoice = await findBocpInvoice(number, searchFrom(document.invoice_requested_at));
  } catch {
    return { ok: false, message: "BOCP nu a răspuns. Căutarea funcționează doar de pe rețeaua permisă în BOCP; încearcă din nou." };
  }
  if (!invoice) return { ok: false, message: `Nu am găsit factura „${number}” în BOCP. Verifică numărul (seria și numărul, ex. B2BREB-596).` };
  if (invoice.cancelled) return { ok: false, message: `Factura ${invoice.number} este anulată în BOCP.` };
  const [{ data: cart }, { data: other }] = await Promise.all([
    supabase.from("partner_carts").select("id,partners(business_name)").eq("bocp_invoice_id", invoice.bocpInvoiceId).limit(1).maybeSingle(),
    supabase.from("sales_documents").select("id,client_name").eq("bocp_invoice_id", invoice.bocpInvoiceId).neq("id", documentId).limit(1).maybeSingle(),
  ]);
  const takenBy = cart?.partners?.business_name ?? other?.client_name;
  const warning = cart || other ? `Atenție: factura este deja asociată unei comenzi pentru ${takenBy ?? "alt client"}.` : null;
  return { ok: true, invoice, warning };
}

export async function findDocumentInvoice(documentId: string, invoiceNumber: string): Promise<Lookup> {
  return documentLookup(documentId, invoiceNumber);
}

export async function markDocumentInvoiced(documentId: string, invoiceNumber: string): Promise<{ ok: boolean; message: string }> {
  const found = await documentLookup(documentId, invoiceNumber);
  if (!found.ok) return found;
  const { supabase } = await requireRole(["admin", "operator_facturare"]);
  const { invoice } = found;
  const { data, error } = await supabase.rpc("mark_document_invoiced", {
    p_id: documentId, p_invoice_number: invoice.number, p_bocp_invoice_id: invoice.bocpInvoiceId, p_invoice_date: invoice.date, p_invoice_pdf_url: invoice.pdfUrl,
  });
  if (error) return { ok: false, message: "Nu am putut salva. Încearcă din nou." };
  if (data === true) await recordInvoicePayment(supabase, "document", documentId, invoice);
  revalidatePath("/billing");
  return data === true
    ? { ok: true, message: `Proforma a fost marcată ca facturată (${invoice.number}). Agentul a fost anunțat.` }
    : { ok: false, message: "Proforma a fost deja facturată. Reîncarcă pagina." };
}

// Billing confirms it cancelled the proforma document in BOCP (the agent dropped it).
export async function confirmProformaCancelled(documentId: string): Promise<{ ok: boolean; message: string }> {
  if (!uuid.test(documentId)) return { ok: false, message: "Documentul nu este valid." };
  const { supabase } = await requireRole(["admin", "operator_facturare"]);
  const { data, error } = await supabase.rpc("confirm_proforma_cancelled", { p_id: documentId });
  if (error || !data) return { ok: false, message: "Anularea a fost deja confirmată. Reîncarcă pagina." };
  revalidatePath("/billing");
  return { ok: true, message: "Anularea a fost confirmată. Agentul a fost anunțat." };
}

// Consignment: the handed carts leave on a BOCP transfer voucher instead of an invoice.
export async function markCartsTransferred(cartIds: string[], transferNumber: string): Promise<{ ok: boolean; message: string }> {
  if (cartIds.length === 0 || cartIds.length > 20 || !cartIds.every((id) => uuid.test(id))) return { ok: false, message: "Comenzile nu sunt valide." };
  const number = transferNumber.trim();
  if (!number || number.length > 60) return { ok: false, message: "Introdu numărul bonului de transfer din BOCP." };
  const { supabase } = await requireRole(["admin", "operator_facturare"]);
  const { data, error } = await supabase.rpc("mark_partner_carts_transferred", { p_cart_ids: cartIds, p_transfer_number: number });
  if (error) return { ok: false, message: "Nu am putut salva. Încearcă din nou." };
  if (!data) return { ok: false, message: "Comenzile s-au schimbat între timp. Reîncarcă pagina." };
  revalidatePath("/billing");
  return { ok: true, message: `Marfa a fost trecută în consignație cu bonul de transfer ${number}.` };
}

// Consignment settlement: the BOCP invoice issued for what the client sold closes the period.
export async function settleConsignment(partnerId: string, periodTo: string, invoiceNumber: string): Promise<{ ok: boolean; message: string }> {
  if (!uuid.test(partnerId) || Number.isNaN(Date.parse(periodTo))) return { ok: false, message: "Decontul nu este valid." };
  const number = invoiceNumber.trim();
  if (!number || number.length > 60) return { ok: false, message: "Introdu numărul facturii din BOCP." };
  const { supabase } = await requireRole(["admin", "operator_facturare"]);
  let invoice: BocpInvoiceMatch | null;
  try {
    invoice = await findBocpInvoice(number, searchFrom(new Date(Date.now() - 60 * 86400000).toISOString()));
  } catch {
    return { ok: false, message: "BOCP nu a răspuns. Căutarea funcționează doar de pe rețeaua permisă în BOCP; încearcă din nou." };
  }
  if (!invoice) return { ok: false, message: `Nu am găsit factura „${number}” în BOCP (ultimele 60 de zile).` };
  if (invoice.cancelled) return { ok: false, message: `Factura ${invoice.number} este anulată în BOCP.` };
  const { data, error } = await supabase.rpc("record_consignment_settlement", {
    p_partner_id: partnerId, p_period_to: periodTo, p_invoice_number: invoice.number, p_bocp_invoice_id: invoice.bocpInvoiceId,
    p_invoice_date: invoice.date || null, p_invoice_pdf_url: invoice.pdfUrl, p_invoice_total: invoice.totalAmount, p_invoice_net: invoice.netAmount,
  });
  if (error) return { ok: false, message: error.code === "23505" ? `Factura ${invoice.number} e deja folosită la un decont.` : "Nu am putut salva decontul." };
  if (!data) return { ok: false, message: "Decontul s-a schimbat între timp. Reîncarcă pagina." };
  revalidatePath("/billing");
  return { ok: true, message: `Decontul a fost închis cu factura ${invoice.number}.` };
}
