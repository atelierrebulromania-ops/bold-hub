"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { accountErrorMessages, createLogin, deleteLogin, setLoginPassword, type AccountError } from "@/lib/account-admin";
import { lookupAnafCompany, normalizeCui } from "@/lib/anaf";
import { bocpGetList } from "@/lib/bocp/client";
import { createClient } from "@/lib/supabase/server";

const page = "/admin/partners";
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function value(form: FormData, key: string, max: number): string | null {
  const raw = form.get(key);
  if (typeof raw !== "string") return null;
  const text = raw.trim();
  return text && text.length <= max ? text : null;
}

function fail(code: string): never {
  redirect(`${page}?error=${encodeURIComponent(code)}`);
}

function done(code: string): never {
  revalidatePath(page);
  redirect(`${page}?notice=${encodeURIComponent(code)}`);
}

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

export async function createCompany(form: FormData) {
  const { supabase } = await adminContext();
  const companyName = value(form, "company_name", 160);
  if (!companyName) fail("company_invalid");
  const { error } = await supabase.from("partner_companies").insert({ company_name: companyName });
  if (error) fail("save_failed");
  done("company_created");
}

export async function createDeliveryGroup(form: FormData) {
  const { supabase } = await adminContext();
  const name = value(form, "name", 120);
  const descriptionRaw = form.get("description");
  const description = typeof descriptionRaw === "string" ? descriptionRaw.trim() : "";
  if (!name || description.length > 500) fail("group_invalid");
  const { error } = await supabase.from("delivery_groups").insert({ name, description: description || null });
  if (error) fail("save_failed");
  done("group_created");
}

export async function createPartner(form: FormData) {
  const { supabase } = await adminContext();
  const companyId = value(form, "company_id", 36);
  const businessName = value(form, "business_name", 160);
  const locationName = value(form, "location_name", 160);
  const phone = value(form, "contact_phone", 30);
  const rawEmail = form.get("contact_email");
  const email = typeof rawEmail === "string" ? rawEmail.trim() : "";
  if (!companyId || !uuid.test(companyId) || !businessName || !locationName || !phone
    || !/^[+0-9 ()-]{7,30}$/.test(phone) || email.length > 254
    || (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) fail("partner_invalid");

  const { error } = await supabase.from("partners").insert({
    company_id: companyId,
    business_name: businessName,
    location_name: locationName,
    contact_phone: phone,
    contact_email: email || null,
    is_important_client: form.get("is_important_client") === "on",
  });
  if (error?.code === "23505") fail("phone_exists");
  if (error) fail("save_failed");
  done("partner_created");
}

export async function assignDeliveryGroup(form: FormData) {
  const { supabase } = await adminContext();
  const partnerId = value(form, "partner_id", 36);
  const groupId = value(form, "delivery_group_id", 36);
  if (!partnerId || !groupId || !uuid.test(partnerId) || !uuid.test(groupId)) fail("selection_invalid");
  const { error } = await supabase.from("partner_delivery_groups")
    .upsert({ partner_id: partnerId, delivery_group_id: groupId },
      { onConflict: "partner_id,delivery_group_id", ignoreDuplicates: true });
  if (error) fail("save_failed");
  done("group_assigned");
}

export async function removeDeliveryGroup(form: FormData) {
  const { supabase } = await adminContext();
  const partnerId = value(form, "partner_id", 36);
  const groupId = value(form, "delivery_group_id", 36);
  if (!partnerId || !groupId || !uuid.test(partnerId) || !uuid.test(groupId)) fail("selection_invalid");
  const { error } = await supabase.from("partner_delivery_groups").delete()
    .eq("partner_id", partnerId).eq("delivery_group_id", groupId);
  if (error) fail("save_failed");
  done("group_removed");
}

export async function setParLevel(form: FormData) {
  const { supabase, userId } = await adminContext();
  const partnerId = value(form, "partner_id", 36);
  const sku = value(form, "sku", 100);
  const rawQuantity = form.get("par_level_quantity");
  const quantity = typeof rawQuantity === "string" ? Number(rawQuantity) : NaN;
  if (!partnerId || !uuid.test(partnerId) || !sku || !Number.isSafeInteger(quantity)
    || quantity < 0 || quantity > 100000) fail("par_invalid");

  const { data: product, error: productError } = await supabase.from("products")
    .select("id").eq("sku", sku).eq("active", true).maybeSingle();
  if (productError) fail("save_failed");
  if (!product) fail("product_missing");

  const { error } = await supabase.from("partner_par_levels").upsert({
    partner_id: partnerId,
    product_id: product.id,
    par_level_quantity: quantity,
    set_by: userId,
    updated_at: new Date().toISOString(),
  }, { onConflict: "partner_id,product_id" });
  if (error) fail("save_failed");
  done("par_saved");
}

function accountFail(error: AccountError): never {
  fail(`account_${error}`);
}

async function partnerForAccount(form: FormData) {
  const { supabase } = await adminContext();
  const partnerId = value(form, "partner_id", 36);
  if (!partnerId || !uuid.test(partnerId)) fail("selection_invalid");
  const { data: partner } = await supabase.from("partners").select("id,auth_user_id").eq("id", partnerId).maybeSingle();
  if (!partner) fail("selection_invalid");
  return { supabase, partner };
}

// Partner logins use a username and password, like staff accounts.
export async function createPartnerAccount(form: FormData) {
  const { supabase, partner } = await partnerForAccount(form);
  if (partner.auth_user_id) fail("account_taken");
  const login = await createLogin(String(form.get("username") ?? ""), String(form.get("password") ?? ""));
  if ("error" in login) accountFail(login.error);
  const { error } = await supabase.from("partners")
    .update({ auth_user_id: login.id, account_username: login.username }).eq("id", partner.id).is("auth_user_id", null);
  if (error) {
    await deleteLogin(login.id);
    fail(error.code === "23505" ? "account_username_taken" : "save_failed");
  }
  done("account_linked");
}

export async function setPartnerPassword(form: FormData) {
  const { partner } = await partnerForAccount(form);
  if (!partner.auth_user_id) fail("selection_invalid");
  const error = await setLoginPassword(partner.auth_user_id, String(form.get("password") ?? ""));
  if (error) accountFail(error);
  done("account_password");
}

export async function removePartnerAccount(form: FormData) {
  const { supabase, partner } = await partnerForAccount(form);
  if (!partner.auth_user_id) fail("selection_invalid");
  const { error } = await supabase.from("partners").update({ auth_user_id: null, account_username: null }).eq("id", partner.id);
  if (error) fail("save_failed");
  const removed = await deleteLogin(partner.auth_user_id);
  if (removed) accountFail(removed);
  done("account_unlinked");
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

// The sales agent (account) responsible for a partner.
export async function setPartnerAgent(form: FormData) {
  const { supabase } = await adminContext();
  const partnerId = value(form, "partner_id", 36);
  const rawAgent = form.get("account_id");
  const agentId = typeof rawAgent === "string" && rawAgent ? rawAgent : null;
  if (!partnerId || !uuid.test(partnerId) || (agentId !== null && !uuid.test(agentId))) fail("selection_invalid");
  if (agentId) {
    const { data: agent } = await supabase.from("app_users").select("id").eq("id", agentId).eq("role", "account").maybeSingle();
    if (!agent) fail("selection_invalid");
  }
  const { error } = await supabase.from("partners").update({ account_id: agentId }).eq("id", partnerId);
  if (error) fail("save_failed");
  done("agent_saved");
}
