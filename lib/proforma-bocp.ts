import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { normalizeCui } from "@/lib/anaf";
import { sendConnectorOrder, updateConnectorOrder, type ConnectorOrder } from "@/lib/bocp/connector";
import { findIssuedProforma } from "@/lib/bocp/proformas";
import type { Database } from "@/lib/database.types";
import { formatMoney, lineDiscount, money } from "@/lib/pricing";

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

// The proforma as a connector order: list prices, and the discounts (each product's own or the document's) as one "Discount X%" line
// per percent and VAT rate, paid by bank transfer (so BOCP issues the proforma). The order id is the document id, so a retry never
// duplicates it.
function connectorOrder(document: ProformaDocument, date: string, cancelled = false): { order: ConnectorOrder; total: number } {
  let total = 0;
  const discounts = new Map<string, NonNullable<ConnectorOrder["discounts"]>[number]>();
  const items = [...document.sales_document_items].sort((a, b) => a.position - b.position).map((item) => {
    const vat = 1 + item.vat_percent / 100;
    const percent = lineDiscount(item, document.discount_percent);
    const price = money(item.unit_price);
    const priceWithVat = money(item.unit_price * vat);
    const discounted = money(item.unit_price * (1 - percent / 100));
    const discountedWithVat = money(discounted * vat);
    total += money(discountedWithVat * item.quantity);
    if (percent > 0) {
      const key = `${percent}|${item.vat_percent}`;
      const line = discounts.get(key) ?? { name: `Discount ${percent}%`, vatPercent: item.vat_percent, value: 0, valueWithVat: 0 };
      line.value = money(line.value + (price - discounted) * item.quantity);
      line.valueWithVat = money(line.valueWithVat + (priceWithVat - discountedWithVat) * item.quantity);
      discounts.set(key, line);
    }
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
        uniqueId: normalizeCui(vatId) ?? undefined,
      },
      items,
      discounts: [...discounts.values()],
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
      // On the last try, the client's proforma with another total: BOCP priced it differently. It is linked anyway, with a warning.
      if (!proforma && attempt === attempts - 1) {
        proforma = await findIssuedProforma({ issuedFrom: sentOn, total: null, clientName: document.client_name, exclude });
      }
    } catch {
      return { ok: false, message: "BOCP nu a răspuns. Verifică din nou peste câteva secunde (funcționează doar de pe rețeaua permisă în BOCP)." };
    }
    if (proforma) {
      const { data } = await supabase.rpc("record_proforma_number", {
        p_id: documentId, p_bocp_proforma_id: proforma.bocpProformaId, p_number: proforma.number, p_date: proforma.date, p_total: proforma.total,
      });
      if (!data) return { ok: false, message: "Nu am putut salva proforma. Reîncarcă pagina." };
      return Math.abs(proforma.total - total) < 0.1
        ? { ok: true, message: `Proforma ${proforma.number} a fost emisă în BOCP.` }
        : { ok: false, message: `Proforma ${proforma.number} a fost emisă în BOCP cu ${formatMoney(proforma.total)} lei, nu cu ${formatMoney(total)} lei. Verifică prețurile cu facturarea.` };
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
