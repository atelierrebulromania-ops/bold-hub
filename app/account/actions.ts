"use server";

import { revalidatePath } from "next/cache";
import { b2bSkuFilter } from "@/lib/b2b-products";
import { accountErrorMessages, createLogin, deleteLogin } from "@/lib/account-admin";
import { lookupAnafCompany, normalizeCui } from "@/lib/anaf";
import { listBocpInvoices } from "@/lib/bocp/invoices";
import { requireRole } from "@/lib/auth";
import type { Json } from "@/lib/database.types";
import { cancelProformaInBocp, issueProformaInBocp, linkIssuedProforma } from "@/lib/proforma-bocp";
import { createAdminClient } from "@/lib/supabase/admin";

type Result = { ok: boolean; message: string };

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function agent() {
  return requireRole(["admin", "account"]);
}

export type ClientInput = {
  businessName: string;
  locationName: string;
  contactPhone: string;
  contactEmail: string;
  type: "reseller" | "horeca" | "altul";
  isImportantClient: boolean;
  billingName: string;
  vatId: string;
  registrationNumber: string;
  street: string;
  city: string;
  county: string;
  zip: string;
};

export async function lookupCompany(cui: string) {
  await agent();
  const result = await lookupAnafCompany(cui);
  if (!result.ok) return { ok: false, message: result.error };
  const company = result.company;
  const warning = company.deregistered ? " Atenție: firma apare radiată la ANAF." : company.inactive ? " Atenție: firma apare inactivă la ANAF." : "";
  return { ok: !company.deregistered && !company.inactive, message: `Date preluate de la ANAF: ${company.name}.${warning}`, company };
}

// Creates (clientId null) or edits one of the agent's clients. A new client belongs to the agent.
export async function saveClient(clientId: string | null, input: ClientInput): Promise<Result & { id?: string }> {
  const { supabase, profile } = await agent();
  if (clientId !== null && !uuid.test(clientId)) return { ok: false, message: "Clientul nu este valid." };
  const digits = normalizeCui(input.vatId);
  if (!digits) return { ok: false, message: "Introdu un CUI valid (obligatoriu)." };
  if (!input.billingName.trim() || !input.street.trim() || !input.city.trim() || !input.county.trim()) {
    return { ok: false, message: "Completează denumirea firmei și adresa (stradă, oraș, județ)." };
  }
  const { data, error } = await supabase.rpc("save_partner_profile", {
    p_partner_id: clientId,
    p_data: {
      business_name: input.businessName, location_name: input.locationName, contact_phone: input.contactPhone,
      contact_email: input.contactEmail, type: input.type, is_important_client: input.isImportantClient,
      billing_name: input.billingName, vat_id: /^ro/i.test(input.vatId.trim()) ? `RO${digits}` : digits,
      registration_number: input.registrationNumber, billing_street: input.street, billing_city: input.city,
      billing_county: input.county, billing_zip: input.zip,
      // In dev mode the admin plays an agent: new clients go to the account shown.
      account_id: profile.role === "account" ? profile.id : "",
    } as Json,
  });
  if (error) {
    return { ok: false, message: error.code === "23505" ? "Există deja un client cu acest telefon." : "Verifică numele, locația, telefonul și tipul clientului." };
  }
  if (!data) return { ok: false, message: "Nu ai acces la acest client." };
  revalidatePath("/account");
  return { ok: true, message: clientId ? "Clientul a fost actualizat." : "Clientul a fost adăugat.", id: data };
}

export async function saveDiscounts(clientId: string, rules: { category: string | null; percent: number }[]): Promise<Result> {
  const { supabase } = await agent();
  if (!uuid.test(clientId)) return { ok: false, message: "Clientul nu este valid." };
  if (rules.length > 100 || rules.some((rule) => !(rule.percent > 0 && rule.percent < 100))) return { ok: false, message: "Discountul trebuie să fie între 0 și 100%." };
  const categories = rules.map((rule) => rule.category ?? "");
  if (new Set(categories).size !== categories.length) return { ok: false, message: "Fiecare categorie poate avea o singură regulă." };
  const { data, error } = await supabase.rpc("save_partner_discounts", {
    p_partner_id: clientId,
    p_rules: rules.map((rule) => ({ category: rule.category, percent: String(Math.round(rule.percent * 100) / 100) })) as Json,
  });
  if (error || !data) return { ok: false, message: "Nu am putut salva discounturile." };
  revalidatePath("/account");
  return { ok: true, message: "Discounturile au fost salvate." };
}

export async function setClientParLevel(clientId: string, productId: string, quantity: number): Promise<Result> {
  const { supabase } = await agent();
  if (!uuid.test(clientId) || !uuid.test(productId) || !Number.isSafeInteger(quantity) || quantity < 0 || quantity > 100000) {
    return { ok: false, message: "Cantitate invalidă." };
  }
  const { data, error } = await supabase.rpc("set_partner_par_level", { p_partner_id: clientId, p_product_id: productId, p_quantity: quantity });
  if (error || !data) return { ok: false, message: "Nu am putut salva stocul inițial." };
  revalidatePath("/account");
  return { ok: true, message: quantity === 0 ? "Produsul a fost scos din stocul inițial." : "Stocul inițial a fost salvat." };
}

export async function addClientRequest(clientId: string, lines: { productId: string; quantity: number }[], source: "whatsapp" | "telefon"): Promise<Result> {
  const { supabase } = await agent();
  if (!uuid.test(clientId) || !lines.length || lines.length > 100
    || lines.some((line) => !uuid.test(line.productId) || !Number.isSafeInteger(line.quantity) || line.quantity < 1 || line.quantity > 100000)) {
    return { ok: false, message: "Verifică produsele și cantitățile." };
  }
  const { error } = await supabase.rpc("staff_add_refill", {
    p_partner_id: clientId,
    p_items: lines.map((line) => ({ product_id: line.productId, quantity: line.quantity })) as Json,
    p_source: source,
  });
  if (error) return { ok: false, message: "Nu am putut adăuga cererea." };
  revalidatePath("/account");
  revalidatePath("/partners");
  return { ok: true, message: "Cererea a ajuns la depozit (Comenzi B2B → Necesită produse)." };
}

// Login for one of the agent's clients (username + password), like the admin does it.
export async function createClientLogin(clientId: string, username: string, password: string): Promise<Result> {
  const { supabase } = await agent();
  if (!uuid.test(clientId)) return { ok: false, message: "Clientul nu este valid." };
  const { data: allowed } = await supabase.from("partners").select("id,auth_user_id").eq("id", clientId).maybeSingle();
  if (!allowed) return { ok: false, message: "Nu ai acces la acest client." };
  if (allowed.auth_user_id) return { ok: false, message: "Clientul are deja un cont." };
  const admin = createAdminClient();
  if (!admin) return { ok: false, message: accountErrorMessages.no_service_key };
  const login = await createLogin(username, password);
  if ("error" in login) return { ok: false, message: accountErrorMessages[login.error] };
  const { error } = await admin.from("partners").update({ auth_user_id: login.id, account_username: login.username })
    .eq("id", clientId).is("auth_user_id", null);
  if (error) {
    await deleteLogin(login.id);
    return { ok: false, message: error.code === "23505" ? accountErrorMessages.username_taken : accountErrorMessages.failed };
  }
  revalidatePath("/account");
  return { ok: true, message: `Contul „${login.username}” a fost creat. Dă-i clientului username-ul și parola.` };
}

export type DocumentInput = {
  kind: "offer" | "proforma";
  partnerId: string | null;
  clientName: string;
  clientVatId: string;
  clientRegistration: string;
  clientStreet: string;
  clientCity: string;
  clientCounty: string;
  clientZip: string;
  contactName: string;
  contactEmail: string;
  contactPhone: string;
  saveAsPartner: boolean;
  discountPercent: number;
  validityDays: number;
  notes: string;
  // discountPercent: the product's own discount; null = the document's.
  items: { productId: string; quantity: number; discountPercent: number | null }[];
};

export async function saveDocument(documentId: string | null, input: DocumentInput): Promise<Result & { id?: string }> {
  const { supabase } = await agent();
  if (documentId !== null && !uuid.test(documentId)) return { ok: false, message: "Documentul nu este valid." };
  if (!input.clientName.trim()) return { ok: false, message: "Completează numele clientului." };
  if (input.kind === "proforma" && !normalizeCui(input.clientVatId)) return { ok: false, message: "Proforma are nevoie de un CUI valid." };
  if (input.kind === "proforma" && (!input.clientStreet.trim() || !input.clientCity.trim() || !input.clientCounty.trim())) {
    return { ok: false, message: "Proforma se emite în BOCP: completează adresa clientului (stradă, oraș, județ)." };
  }
  if (input.saveAsPartner && !input.contactPhone.trim()) return { ok: false, message: "Ca să salvezi clientul ca partener, completează telefonul." };
  if (!input.items.length) return { ok: false, message: "Adaugă cel puțin un produs." };
  if (input.items.some((item) => item.discountPercent !== null && !(item.discountPercent >= 0 && item.discountPercent < 100))) {
    return { ok: false, message: "Discountul unui produs trebuie să fie între 0 și 100%." };
  }
  if (!(input.discountPercent >= 0 && input.discountPercent < 100)) return { ok: false, message: "Discountul trebuie să fie între 0 și 100%." };
  const { data, error } = await supabase.rpc("save_sales_document", {
    p_id: documentId,
    p_doc: {
      kind: input.kind, partner_id: input.partnerId ?? "", client_name: input.clientName, client_vat_id: input.clientVatId,
      client_registration: input.clientRegistration, client_street: input.clientStreet, client_city: input.clientCity,
      client_county: input.clientCounty, client_zip: input.clientZip, contact_name: input.contactName, contact_email: input.contactEmail,
      contact_phone: input.contactPhone, save_as_partner: input.saveAsPartner, discount_percent: String(input.discountPercent),
      validity_days: String(input.validityDays), notes: input.notes,
    } as Json,
    p_items: input.items.map((item) => ({ product_id: item.productId, quantity: String(item.quantity),
      discount_percent: item.discountPercent === null ? "" : String(Math.round(item.discountPercent * 100) / 100) })) as Json,
  });
  if (error) return { ok: false, message: /price/i.test(error.message) ? "Un produs nu are preț în BOCP. Scoate-l sau sincronizează catalogul." : "Verifică datele documentului." };
  if (!data) return { ok: false, message: "Documentul nu mai poate fi modificat." };
  revalidatePath("/account/offers");
  return { ok: true, message: "Ciorna a fost salvată.", id: data };
}

// Offers get their number in the Hub; proformas are issued in BOCP.
export async function issueDocument(documentId: string): Promise<Result & { number?: string }> {
  const { supabase } = await agent();
  if (!uuid.test(documentId)) return { ok: false, message: "Documentul nu este valid." };
  const { data: document } = await supabase.from("sales_documents").select("kind").eq("id", documentId).maybeSingle();
  if (!document) return { ok: false, message: "Documentul nu mai există." };
  if (document.kind === "proforma") {
    const result = await issueProformaInBocp(supabase, documentId);
    revalidatePath("/account/offers");
    revalidatePath("/account");
    return result;
  }
  const { data, error } = await supabase.rpc("issue_sales_document", { p_id: documentId });
  if (error) return { ok: false, message: error.code === "23505" ? "Există deja un partener cu acest telefon. Alege-l din listă în loc să-l salvezi din nou." : "Nu am putut emite documentul." };
  if (!data) return { ok: false, message: "Documentul a fost deja emis." };
  revalidatePath("/account/offers");
  revalidatePath("/account");
  return { ok: true, message: `Oferta a primit numărul ${data}.`, number: data };
}

// A proforma sent to BOCP whose number did not show up yet.
export async function checkProforma(documentId: string): Promise<Result> {
  const { supabase } = await agent();
  if (!uuid.test(documentId)) return { ok: false, message: "Documentul nu este valid." };
  const result = await linkIssuedProforma(supabase, documentId, 2);
  revalidatePath("/account/offers");
  return result;
}

export async function offerToProforma(documentId: string): Promise<Result & { id?: string }> {
  const { supabase } = await agent();
  if (!uuid.test(documentId)) return { ok: false, message: "Documentul nu este valid." };
  const { data } = await supabase.rpc("offer_to_proforma", { p_id: documentId });
  if (!data) return { ok: false, message: "Oferta trebuie să fie emisă." };
  revalidatePath("/account/offers");
  return { ok: true, message: "Proforma a fost creată ca ciornă. Verifică datele și emite-o.", id: data };
}

// "Rezervă comanda": the proforma's products go to the warehouse (shelf), then to billing.
export async function reserveDocumentOrder(documentId: string): Promise<Result> {
  const { supabase } = await agent();
  if (!uuid.test(documentId)) return { ok: false, message: "Documentul nu este valid." };
  const { data, error } = await supabase.rpc("send_sales_document", { p_id: documentId });
  if (error?.code === "55000") return { ok: false, message: "Clientul are deja o comandă deschisă din altă proformă. Așteaptă să fie pusă pe raft." };
  if (error || !data) return { ok: false, message: "Proforma trebuie să fie emisă, pentru un partener, și fără cerere de factură." };
  revalidatePath("/account/offers");
  revalidatePath("/partners");
  return { ok: true, message: "Comanda a ajuns la depozit. După ce e pusă pe raft și predată, facturarea emite factura." };
}

// "Cere factura": billing invoices the proforma directly, without the warehouse.
export async function requestDocumentInvoice(documentId: string): Promise<Result> {
  const { supabase } = await agent();
  if (!uuid.test(documentId)) return { ok: false, message: "Documentul nu este valid." };
  const { data } = await supabase.rpc("request_document_invoice", { p_id: documentId });
  if (!data) return { ok: false, message: "Nu am putut trimite cererea. Reîncarcă pagina." };
  revalidatePath("/account/offers");
  return { ok: true, message: "Cererea a ajuns la facturare. Factura apare aici când e emisă." };
}

export async function cancelProforma(documentId: string, reason: string): Promise<Result> {
  const { supabase } = await agent();
  if (!uuid.test(documentId) || reason.length > 500) return { ok: false, message: "Documentul nu este valid." };
  const result = await cancelProformaInBocp(supabase, documentId, reason);
  revalidatePath("/account/offers");
  return result;
}

export type InvoiceSuggestion = { productId: string; name: string; sku: string; quantity: number; invoices: number; lastDate: string };

// Products a client bought (its BOCP invoices of the last 3 months) that are not on its shelf yet.
// Invoices are matched by the linked BOCP contact, or by CUI.
export async function suggestFromInvoices(clientId: string): Promise<Result & { items?: InvoiceSuggestion[] }> {
  const { supabase } = await agent();
  if (!uuid.test(clientId)) return { ok: false, message: "Clientul nu este valid." };
  const { data: client } = await supabase.from("partners").select("id,bocp_contact_id,vat_id,partner_par_levels(product_id)").eq("id", clientId).maybeSingle();
  if (!client) return { ok: false, message: "Nu ai acces la acest client." };
  const cui = normalizeCui(client.vat_id ?? "");
  if (!client.bocp_contact_id && !cui) return { ok: false, message: "Clientul nu are CUI și nu e legat de un contact BOCP." };

  // BOCP invoice pages are slow (they carry the lines): months are read two at a time, which BOCP
  // accepts (six at once gets 429 Too Many Requests).
  const day = (date: Date) => new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Bucharest" }).format(date);
  const months = Array.from({ length: 3 }, (_, index) => {
    const start = new Date();
    start.setDate(1);
    start.setMonth(start.getMonth() - index);
    const end = new Date(start.getFullYear(), start.getMonth() + 1, 0);
    return { from: day(start), through: day(end) };
  });
  const bought = new Map<string, { quantity: number; invoices: number; lastDate: string }>();
  const readMonth = async (month: { from: string; through: string }) => {
    const rows: unknown[] = [];
    let page: number | null = 1;
    for (let fetched = 0; page !== null && fetched < 15; fetched++) {
      const result = await listBocpInvoices({ dateFrom: month.from, dateThrough: month.through, page });
      rows.push(...result.rows);
      page = result.nextPage;
    }
    return rows;
  };
  try {
    const pages: unknown[] = [];
    for (let index = 0; index < months.length; index += 2) {
      for (const rows of await Promise.all(months.slice(index, index + 2).map(readMonth))) pages.push(...rows);
    }
    for (const raw of pages) {
      const row = raw as Record<string, unknown>;
      const sameContact = client.bocp_contact_id && String(row.bocp_contact_id ?? "") === client.bocp_contact_id;
      const sameCui = cui && normalizeCui(String(row.client_vat_id ?? "")) === cui;
      if ((!sameContact && !sameCui) || String(row.document_cancelled ?? "") === "1" || !Array.isArray(row.items)) continue;
      const date = String(row.doc_date ?? "").slice(0, 10);
      for (const rawItem of row.items) {
        const item = rawItem as Record<string, unknown>;
        const sku = String(item.item_code ?? "").trim();
        const quantity = Number(item.qty_mu1);
        if (!sku || !(quantity > 0)) continue;
        const entry = bought.get(sku) ?? { quantity: 0, invoices: 0, lastDate: date };
        entry.quantity += quantity;
        entry.invoices += 1;
        if (date > entry.lastDate) entry.lastDate = date;
        bought.set(sku, entry);
      }
    }
  } catch {
    return { ok: false, message: "BOCP nu a răspuns. Încearcă din nou (funcționează doar de pe rețeaua permisă în BOCP)." };
  }
  if (!bought.size) return { ok: true, message: "Nu am găsit facturi pentru acest client în ultimele 3 luni.", items: [] };

  const { data: products } = await supabase.from("products").select("id,name,sku").in("sku", [...bought.keys()]).eq("active", true).or(b2bSkuFilter);
  const onShelf = new Set(client.partner_par_levels.map((level) => level.product_id));
  const items = (products ?? []).filter((product) => !onShelf.has(product.id)).map((product) => {
    const entry = bought.get(product.sku)!;
    // A starting shelf quantity: the average bought per invoice.
    return { productId: product.id, name: product.name, sku: product.sku, quantity: Math.max(1, Math.round(entry.quantity / entry.invoices)), invoices: entry.invoices, lastDate: entry.lastDate };
  }).sort((a, b) => b.invoices - a.invoices || a.name.localeCompare(b.name, "ro"));
  return { ok: true, message: items.length ? `${items.length} ${items.length === 1 ? "produs cumpărat nu e" : "produse cumpărate nu sunt"} încă în stocul inițial.` : "Tot ce a cumpărat clientul e deja în stocul inițial.", items };
}
