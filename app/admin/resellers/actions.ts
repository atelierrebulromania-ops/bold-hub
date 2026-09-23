"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

const page = "/admin/resellers";
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
  const { error } = await supabase.from("reseller_companies").insert({ company_name: companyName });
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

export async function createReseller(form: FormData) {
  const { supabase } = await adminContext();
  const companyId = value(form, "company_id", 36);
  const businessName = value(form, "business_name", 160);
  const locationName = value(form, "location_name", 160);
  const phone = value(form, "contact_phone", 30);
  const rawEmail = form.get("contact_email");
  const email = typeof rawEmail === "string" ? rawEmail.trim() : "";
  if (!companyId || !uuid.test(companyId) || !businessName || !locationName || !phone
    || !/^[+0-9 ()-]{7,30}$/.test(phone) || email.length > 254
    || (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) fail("reseller_invalid");

  const { error } = await supabase.from("resellers").insert({
    company_id: companyId,
    business_name: businessName,
    location_name: locationName,
    contact_phone: phone,
    contact_email: email || null,
    is_important_client: form.get("is_important_client") === "on",
  });
  if (error?.code === "23505") fail("phone_exists");
  if (error) fail("save_failed");
  done("reseller_created");
}

export async function assignDeliveryGroup(form: FormData) {
  const { supabase } = await adminContext();
  const resellerId = value(form, "reseller_id", 36);
  const groupId = value(form, "delivery_group_id", 36);
  if (!resellerId || !groupId || !uuid.test(resellerId) || !uuid.test(groupId)) fail("selection_invalid");
  const { error } = await supabase.from("reseller_delivery_groups")
    .upsert({ reseller_id: resellerId, delivery_group_id: groupId },
      { onConflict: "reseller_id,delivery_group_id", ignoreDuplicates: true });
  if (error) fail("save_failed");
  done("group_assigned");
}

export async function removeDeliveryGroup(form: FormData) {
  const { supabase } = await adminContext();
  const resellerId = value(form, "reseller_id", 36);
  const groupId = value(form, "delivery_group_id", 36);
  if (!resellerId || !groupId || !uuid.test(resellerId) || !uuid.test(groupId)) fail("selection_invalid");
  const { error } = await supabase.from("reseller_delivery_groups").delete()
    .eq("reseller_id", resellerId).eq("delivery_group_id", groupId);
  if (error) fail("save_failed");
  done("group_removed");
}

export async function setParLevel(form: FormData) {
  const { supabase, userId } = await adminContext();
  const resellerId = value(form, "reseller_id", 36);
  const sku = value(form, "sku", 100);
  const rawQuantity = form.get("par_level_quantity");
  const quantity = typeof rawQuantity === "string" ? Number(rawQuantity) : NaN;
  if (!resellerId || !uuid.test(resellerId) || !sku || !Number.isSafeInteger(quantity)
    || quantity < 0 || quantity > 100000) fail("par_invalid");

  const { data: product, error: productError } = await supabase.from("products")
    .select("id").eq("sku", sku).eq("active", true).maybeSingle();
  if (productError) fail("save_failed");
  if (!product) fail("product_missing");

  const { error } = await supabase.from("reseller_par_levels").upsert({
    reseller_id: resellerId,
    product_id: product.id,
    par_level_quantity: quantity,
    set_by: userId,
    updated_at: new Date().toISOString(),
  }, { onConflict: "reseller_id,product_id" });
  if (error) fail("save_failed");
  done("par_saved");
}

const linkResults: Record<string, string> = {
  linked: "account_linked",
  unlinked: "account_unlinked",
  no_user: "account_no_user",
  staff_account: "account_staff",
  already_linked: "account_taken",
};

export async function linkAccount(form: FormData) {
  const { supabase } = await adminContext();
  const resellerId = value(form, "reseller_id", 36);
  const rawEmail = form.get("email");
  const email = typeof rawEmail === "string" ? rawEmail.trim() : "";
  if (!resellerId || !uuid.test(resellerId) || email.length > 254
    || (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) fail("account_invalid");
  const { data, error } = await supabase.rpc("link_reseller_account", { p_reseller_id: resellerId, p_email: email });
  if (error || !data) fail("save_failed");
  const code = linkResults[data];
  if (!code) fail("save_failed");
  if (data === "linked" || data === "unlinked") done(code);
  fail(code);
}
