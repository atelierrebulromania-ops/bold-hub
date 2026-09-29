import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { sendConnectorOrder, updateConnectorOrder, type ConnectorOrder } from "@/lib/bocp/connector";
import { findIssuedProforma } from "@/lib/bocp/proformas";
import type { Database } from "@/lib/database.types";
import { lineDiscount, money } from "@/lib/pricing";

type Client = SupabaseClient<Database>;
type Result = { ok: boolean; message: string };

const documentFields = "id,kind,status,number,bocp_order_id,bocp_proforma_id,issued_at,created_at,updated_at,client_name,client_vat_id,client_registration,client_street,client_city,client_county,client_zip,contact_email,contact_phone,discount_percent,partners(contact_phone,contact_email,location_name),sales_document_items(sku,name,quantity,unit_price,vat_percent,discount_percent,position)" as const;

function bucharestDay(date = new Date()) {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Bucharest" }).format(date);
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function loadDocument(supabase: Client, documentId: string) {
  const { data } = await supabase.from("sales_documents").select(documentFields).eq("id", documentId).maybeSingle();
  return data;
}

type ProformaDocument = NonNullable<Awaited<ReturnType<typeof loadDocument>>>;

// The proforma as a connector order: document prices with their discounts (per product or the document's), paid by bank transfer (so
// BOCP issues the proforma). The order id is the document id, so a retry never duplicates it.
function connectorOrder(document: ProformaDocument, date: string, cancelled = false): { order: ConnectorOrder; total: number } {
  let total = 0;
  const items = [...document.sales_document_items].sort((a, b) => a.position - b.position).map((item) => {
    const price = money(item.unit_price * (1 - lineDiscount(item, document.discount_percent) / 100));
    const priceWithVat = money(price * (1 + item.vat_percent / 100));
    total += money(priceWithVat * item.quantity);
    return { code: item.sku, name: item.name, quantity: item.quantity, price, priceWithVat, vatPercent: item.vat_percent };
  });
  const vatId = document.client_vat_id?.trim() ?? "";
  return {
    total: money(total),
    order: {
      orderId: `BH-PF-${document.id}`,
      date,
      mentions: `Proformă BoldHub — ${document.client_name}`,
      client: {
        name: document.client_name, isCompany: vatId.length > 0, vatId, registrationNumber: document.client_registration ?? "",
        phone: document.contact_phone || document.partners?.contact_phone || "", email: document.contact_email || document.partners?.contact_email || "",
        address: { street: document.client_street ?? "", city: document.client_city ?? "", county: document.client_county ?? "", zip: document.client_zip ?? "", country: "Romania" },
      },
      items,
      withProforma: true,
      cancelled,
    },
  };
}

// Looks for the proforma BOCP issued for the document's order and links it. BOCP issues it a few
// seconds after the order arrives, so this retries for a short while.
export async function linkIssuedProforma(supabase: Client, documentId: string, attempts = 1): Promise<Result> {
  const document = await loadDocument(supabase, documentId);
  if (!document || document.status !== "issuing" || !document.bocp_order_id) return { ok: false, message: "Proforma nu mai așteaptă numărul din BOCP. Reîncarcă pagina." };
  // The order was sent at the last update of the document (record_proforma_order).
  const sentOn = bucharestDay(new Date(document.updated_at));
  const { total } = connectorOrder(document, sentOn);
  const { data: linked } = await supabase.from("sales_documents").select("bocp_proforma_id").not("bocp_proforma_id", "is", null).limit(1000);
  const exclude = new Set((linked ?? []).map((row) => row.bocp_proforma_id).filter((id): id is string => !!id));

  for (let attempt = 0; attempt < attempts; attempt++) {
    if (attempt > 0) await wait(3000);
    let proforma;
    try {
      proforma = await findIssuedProforma({ issuedFrom: sentOn, total, clientName: document.client_name, exclude });
    } catch {
      return { ok: false, message: "BOCP nu a răspuns. Verifică din nou peste câteva secunde (funcționează doar de pe rețeaua permisă în BOCP)." };
    }
    if (proforma) {
      const { data } = await supabase.rpc("record_proforma_number", {
        p_id: documentId, p_bocp_proforma_id: proforma.bocpProformaId, p_number: proforma.number, p_date: proforma.date, p_total: proforma.total,
      });
      return data ? { ok: true, message: `Proforma ${proforma.number} a fost emisă în BOCP.` } : { ok: false, message: "Nu am putut salva proforma. Reîncarcă pagina." };
    }
  }
  return { ok: false, message: "Comanda a ajuns în BOCP, dar proforma nu apare încă. Apasă „Verifică în BOCP” peste câteva secunde." };
}

// "Emite proforma": sends the order to BOCP (which issues the proforma and reserves the stock),
// then links the proforma.
export async function issueProformaInBocp(supabase: Client, documentId: string): Promise<Result> {
  const { data: started, error } = await supabase.rpc("start_proforma_issue", { p_id: documentId });
  if (error) {
    return { ok: false, message: error.code === "23505" ? "Există deja un partener cu acest telefon. Alege-l din listă în loc să-l salvezi din nou."
      : /CUI/.test(error.message) ? "Proforma are nevoie de CUI și de adresa completă a clientului (stradă, oraș, județ)." : "Nu am putut emite proforma." };
  }
  if (!started) return { ok: false, message: "Proforma a fost deja emisă. Reîncarcă pagina." };

  const document = await loadDocument(supabase, documentId);
  if (!document) return { ok: false, message: "Documentul nu mai există." };
  const { order } = connectorOrder(document, bucharestDay());
  const sent = await sendConnectorOrder(order);
  await supabase.rpc("record_proforma_order", { p_id: documentId, p_bocp_order_id: sent.ok ? sent.bocpOrderId : null, p_error: sent.ok ? null : sent.error });
  if (!sent.ok) return { ok: false, message: `BOCP: ${sent.error}` };
  return linkIssuedProforma(supabase, documentId, 6);
}

// The agent drops the proforma: the BOCP order is cancelled (stock released), then billing is asked
// to cancel the proforma document in BOCP.
export async function cancelProformaInBocp(supabase: Client, documentId: string, reason: string): Promise<Result> {
  const document = await loadDocument(supabase, documentId);
  if (!document || document.kind !== "proforma" || document.status !== "issued" || !document.bocp_order_id) {
    return { ok: false, message: "Proforma nu mai poate fi anulată. Reîncarcă pagina." };
  }
  const { order } = connectorOrder(document, bucharestDay(new Date(document.issued_at ?? document.created_at)), true);
  const cancelled = await updateConnectorOrder(order);
  if (!cancelled.ok) return { ok: false, message: `BOCP: ${cancelled.error}` };
  const { data } = await supabase.rpc("request_proforma_cancel", { p_id: documentId, p_reason: reason.trim() || null });
  return data
    ? { ok: true, message: `Stocul a fost eliberat în BOCP. Facturarea a primit cererea să anuleze proforma ${document.number}.` }
    : { ok: false, message: "Stocul a fost eliberat, dar cererea către facturare nu s-a salvat. Reîncarcă pagina și încearcă din nou." };
}
