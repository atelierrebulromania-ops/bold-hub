"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { accountErrorMessages, deleteLogin, setLoginPassword } from "@/lib/account-admin";
import { lookupAnafCompany, normalizeCui } from "@/lib/anaf";
import { bocpGetList } from "@/lib/bocp/client";
import { createClient } from "@/lib/supabase/server";

const page = "/admin/partners";
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Result = { ok: boolean; message: string };

async function adminContext() {
  const supabase = await createClient();
  const { data: authData } = await supabase.auth.getClaims();
  const userId = authData?.claims?.sub;
  if (!userId) redirect("/login");
  const { data: profile } = await supabase.from("app_users")
    .select("role,active").eq("id", userId).maybeSingle();
  if (!profile?.active || profile.role !== "admin") redirect("/access");
  return { supabase, userId };
}

export type PartnerBilling = {
  bocpContactId: string | null;
  billingName: string;
  vatId: string;
  registrationNumber: string;
  street: string;
  city: string;
  county: string;
  zip: string;
};

export type BocpContactMatch = PartnerBilling & { bocpContactId: string; pricelist: string | null };

// Existing BOCP clients matching a name or CUI (GET contacts/list), to link a partner to its client.
export async function searchBocpContacts(query: string): Promise<{ ok: boolean; message?: string; contacts: BocpContactMatch[] }> {
  await adminContext();
  const needle = query.trim().toLocaleLowerCase("ro").replace(/^ro/i, "");
  if (needle.length < 3) return { ok: false, message: "Scrie cel puțin 3 caractere din nume sau CUI.", contacts: [] };
  const contacts: BocpContactMatch[] = [];
  try {
    let page: number | null = 1;
    for (let fetched = 0; page !== null && fetched < 20 && contacts.length < 15; fetched++) {
      const result = await bocpGetList("contacts/list/include:address,pricelist", { page });
      for (const raw of result.rows) {
        const row = raw as Record<string, unknown>;
        const text = (key: string) => typeof row[key] === "string" ? (row[key] as string).trim() : typeof row[key] === "number" ? String(row[key]) : "";
        const haystack = `${text("name")} ${text("vat_id").replace(/^ro/i, "")} ${text("client_code")}`.toLocaleLowerCase("ro");
        if (!haystack.includes(needle) || !/^[1-9]\d*$/.test(text("bocp_id"))) continue;
        const addresses = Array.isArray(row.addresses) ? row.addresses as Record<string, unknown>[] : [];
        const address = addresses.find((item) => String(item.is_main) === "1") ?? addresses[0] ?? {};
        const part = (key: string) => typeof address[key] === "string" ? (address[key] as string).trim() : "";
        contacts.push({
          bocpContactId: text("bocp_id"), billingName: text("name"), vatId: text("vat_id"), registrationNumber: text("registration_nr"),
          street: [part("address"), part("address2")].filter(Boolean).join(", "), city: part("city"), county: part("county"), zip: part("postcode"),
          pricelist: text("pricelist_name") || null,
        });
      }
      page = result.nextPage;
    }
  } catch {
    return { ok: false, message: "BOCP nu a răspuns. Căutarea funcționează doar de pe rețeaua permisă în BOCP.", contacts: [] };
  }
  return { ok: true, contacts };
}

// Fills a partner's billing data from ANAF by CUI.
export async function lookupCompanyByCui(cui: string): Promise<{ ok: boolean; message: string; billing?: Omit<PartnerBilling, "bocpContactId"> }> {
  await adminContext();
  const result = await lookupAnafCompany(cui);
  if (!result.ok) return { ok: false, message: result.error };
  const company = result.company;
  const warning = company.deregistered ? " Atenție: firma apare radiată la ANAF." : company.inactive ? " Atenție: firma apare inactivă la ANAF." : "";
  return {
    ok: !company.deregistered && !company.inactive,
    message: `Date preluate de la ANAF: ${company.name}${company.vatPayer ? " (plătitor de TVA)" : " (neplătitor de TVA)"}.${warning} Verifică și salvează.`,
    billing: { billingName: company.name, vatId: company.vatId, registrationNumber: company.registrationNumber,
      street: company.street, city: company.city, county: company.county, zip: company.zip },
  };
}

// Billing data sent to BOCP as the client of the partner's orders.
export async function savePartnerBilling(partnerId: string, billing: PartnerBilling): Promise<{ ok: boolean; message: string }> {
  const { supabase } = await adminContext();
  if (!uuid.test(partnerId)) return { ok: false, message: "Partenerul nu este valid." };
  const clean = (value: string, max: number) => {
    const text = value.trim().replace(/\s+/g, " ");
    return text ? text.slice(0, max) : null;
  };
  // Partners are companies: the CUI is required, so an order never goes out as a private person.
  const digits = normalizeCui(billing.vatId);
  if (!digits) return { ok: false, message: "Introdu un CUI valid (obligatoriu)." };
  const vatId = /^ro/i.test(billing.vatId.trim()) ? `RO${digits}` : digits;
  if (!clean(billing.billingName, 200)) return { ok: false, message: "Introdu denumirea firmei." };
  if (billing.bocpContactId !== null && !/^[1-9]\d{0,18}$/.test(billing.bocpContactId)) return { ok: false, message: "Clientul BOCP nu este valid." };
  const { error } = await supabase.from("partners").update({
    bocp_contact_id: billing.bocpContactId,
    billing_name: clean(billing.billingName, 200),
    vat_id: vatId,
    registration_number: clean(billing.registrationNumber, 40),
    billing_street: clean(billing.street, 200),
    billing_city: clean(billing.city, 80),
    billing_county: clean(billing.county, 80),
    billing_zip: clean(billing.zip, 12),
  }).eq("id", partnerId);
  if (error) return { ok: false, message: "Nu am putut salva datele de facturare." };
  revalidatePath(page);
  return { ok: true, message: "Datele de facturare au fost salvate." };
}

// The sales agent (account) responsible for a client; null leaves it unassigned.
export async function setClientAgent(partnerId: string, agentId: string | null): Promise<Result> {
  const { supabase } = await adminContext();
  if (!uuid.test(partnerId) || (agentId !== null && !uuid.test(agentId))) return { ok: false, message: "Selecția nu este validă." };
  if (agentId) {
    const { data: agent } = await supabase.from("app_users").select("id").eq("id", agentId).eq("role", "account").eq("active", true).maybeSingle();
    if (!agent) return { ok: false, message: "Agentul nu mai este activ." };
  }
  const { error } = await supabase.from("partners").update({ account_id: agentId }).eq("id", partnerId);
  if (error) return { ok: false, message: "Nu am putut salva agentul." };
  revalidatePath(page);
  revalidatePath("/account");
  return { ok: true, message: agentId ? "Agentul a fost salvat." : "Clientul nu mai are agent." };
}

// The client's manager login: a new password, or the login removed (the client can get a new one).
export async function setClientPassword(partnerId: string, password: string): Promise<Result> {
  const { supabase } = await adminContext();
  if (!uuid.test(partnerId)) return { ok: false, message: "Clientul nu este valid." };
  const { data: partner } = await supabase.from("partners").select("auth_user_id").eq("id", partnerId).maybeSingle();
  if (!partner?.auth_user_id) return { ok: false, message: "Clientul nu are cont." };
  const error = await setLoginPassword(partner.auth_user_id, password);
  return error ? { ok: false, message: accountErrorMessages[error] } : { ok: true, message: "Parola a fost schimbată. Dă-i clientului parola nouă; la prima logare își alege una proprie." };
}

export async function deleteClientLogin(partnerId: string): Promise<Result> {
  const { supabase } = await adminContext();
  if (!uuid.test(partnerId)) return { ok: false, message: "Clientul nu este valid." };
  const { data: partner } = await supabase.from("partners").select("auth_user_id").eq("id", partnerId).maybeSingle();
  if (!partner?.auth_user_id) return { ok: false, message: "Clientul nu are cont." };
  const { error } = await supabase.from("partners").update({ auth_user_id: null, account_username: null }).eq("id", partnerId);
  if (error) return { ok: false, message: "Nu am putut șterge contul." };
  const removed = await deleteLogin(partner.auth_user_id);
  revalidatePath(page);
  revalidatePath("/account");
  return removed ? { ok: false, message: accountErrorMessages[removed] } : { ok: true, message: "Contul clientului a fost șters." };
}

// A client deactivated keeps its history but disappears from the boards and cannot sign in.
export async function setClientActive(partnerId: string, active: boolean): Promise<Result> {
  const { supabase } = await adminContext();
  if (!uuid.test(partnerId)) return { ok: false, message: "Clientul nu este valid." };
  const { error } = await supabase.from("partners").update({ active }).eq("id", partnerId);
  if (error) return { ok: false, message: "Nu am putut salva." };
  revalidatePath(page);
  revalidatePath("/account");
  revalidatePath("/partners");
  return { ok: true, message: active ? "Clientul este din nou activ." : "Clientul a fost dezactivat." };
}
