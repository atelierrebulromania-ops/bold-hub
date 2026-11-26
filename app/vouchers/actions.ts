"use server";

import QRCode from "qrcode";
import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth";
import { googleSaveUrl, syncGoogleWallet, testGoogleWallet } from "@/lib/vouchers/google-wallet";
import { loadVoucher, voucherRoles } from "@/lib/vouchers/server";
import { parseVoucher, type FieldErrors, type VoucherInput } from "@/lib/vouchers/validate";
import { allowedOrigins } from "@/lib/vouchers/voucher";

// Voucher actions. Each checks the role (requireRole redirects anyone else), validates with the shared rules
// and writes with the user's own session, so row security applies too. Changes are audited by a trigger.

export type ActionResult<T = undefined> = { ok: true; value: T; warning?: string } | { ok: false; error: string; errors?: FieldErrors };

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const imagePattern = /^vouchers\/[0-9a-f-]{36}\.(jpg|png)$/;
const bucket = "digital-voucher-assets";
const failed = (error = "Could not save. Check your internet connection and try again.") => ({ ok: false as const, error });

function changed(id?: string) {
  revalidatePath("/vouchers");
  revalidatePath("/vouchers/list");
  if (id) revalidatePath(`/vouchers/${id}`);
}

function columns(value: VoucherInput) {
  return {
    name: value.name, internal_name: value.internalName, brand: value.brand, slug: value.slug,
    discount_code: value.discountCode, discount_type: value.discountType, discount_value: value.discountValue, currency: value.currency,
    short_description: value.shortDescription, long_description: value.longDescription,
    starts_at: value.startsAt, expires_at: value.expiresAt, timezone: value.timezone, language: value.language,
    terms: value.terms, internal_notes: value.internalNotes,
    logo_path: value.logoPath, hero_path: value.heroPath,
    background_color: value.backgroundColor.toUpperCase(), text_color: value.textColor.toUpperCase(), accent_color: value.accentColor.toUpperCase(),
    title: value.title, subtitle: value.subtitle, show_discount_value: value.showDiscountValue, show_discount_code: value.showDiscountCode,
    website_url: value.websiteUrl, landing_url: value.landingUrl, discount_url: value.discountUrl, qr_url: value.qrUrl,
    utm_source: value.utmSource, utm_medium: value.utmMedium, utm_campaign: value.utmCampaign, extra_origins: value.extraOrigins,
    google_wallet_enabled: value.googleWalletEnabled, apple_wallet_enabled: value.appleWalletEnabled,
    image_download_enabled: value.imageDownloadEnabled, email_enabled: value.emailEnabled, published: value.published,
  };
}

// Removes a stored image once no voucher uses it any more (duplicates share images).
async function removeImageIfUnused(supabase: Awaited<ReturnType<typeof requireRole>>["supabase"], path: string | null) {
  if (!path || !imagePattern.test(path)) return;
  const { count } = await supabase.from("digital_vouchers").select("id", { count: "exact", head: true }).or(`logo_path.eq."${path}",hero_path.eq."${path}"`);
  if (count === 0) await supabase.storage.from(bucket).remove([path]);
}

// A voucher already sent to Google Wallet is updated there right after it is saved, so saved passes follow.
async function resync(supabase: Awaited<ReturnType<typeof requireRole>>["supabase"], id: string) {
  const { count } = await supabase.from("digital_voucher_wallet_resources").select("id", { count: "exact", head: true }).eq("voucher_id", id).eq("platform", "google");
  if (!count) return undefined;
  const voucher = await loadVoucher(supabase, id);
  if (!voucher?.google_wallet_enabled) return undefined;
  const result = await syncGoogleWallet(supabase, voucher);
  return result.ok ? undefined : `Saved, but Google Wallet was not updated: ${result.error}`;
}

// Creates (id null) or updates a voucher.
export async function saveVoucher(id: string | null, input: Record<string, unknown>): Promise<ActionResult<{ id: string }>> {
  const { supabase, userId } = await requireRole(voucherRoles);
  if (id !== null && !uuid.test(id)) return failed();
  const parsed = parseVoucher(input);
  if (!parsed.ok) return { ok: false, error: "Check the highlighted fields.", errors: parsed.errors };
  const current = id ? await loadVoucher(supabase, id) : null;
  if (id && !current) return failed("The voucher no longer exists. Reload the page.");
  if (current?.archived_at) return failed("An archived voucher cannot be edited. Restore it first.");

  const fields = { ...columns(parsed.value), updated_at: new Date().toISOString(), updated_by: userId };
  const result = id
    ? await supabase.from("digital_vouchers").update(fields).eq("id", id).select("id").single()
    : await supabase.from("digital_vouchers").insert({ ...fields, created_by: userId }).select("id").single();
  if (result.error) {
    if (result.error.code === "23505") return { ok: false, error: "Check the highlighted fields.", errors: { slug: "Another voucher already uses this slug." } };
    return failed();
  }
  const savedId = result.data.id;
  for (const path of [current?.logo_path, current?.hero_path]) {
    if (path && path !== fields.logo_path && path !== fields.hero_path) await removeImageIfUnused(supabase, path);
  }
  const warning = id ? await resync(supabase, savedId) : undefined;
  changed(savedId);
  return { ok: true, value: { id: savedId }, warning };
}

// A full copy as a draft, with a free slug; the copy has no Wallet resources of its own until it is synced.
export async function duplicateVoucher(id: string): Promise<ActionResult<{ id: string }>> {
  const { supabase, userId } = await requireRole(voucherRoles);
  if (!uuid.test(id)) return failed();
  const voucher = await loadVoucher(supabase, id);
  if (!voucher) return failed("The voucher no longer exists. Reload the page.");
  const { data: taken } = await supabase.from("digital_vouchers").select("slug").like("slug", `${voucher.slug}-copy%`);
  const used = new Set((taken ?? []).map(row => row.slug));
  let slug = `${voucher.slug}-copy`.slice(0, 60);
  for (let n = 2; used.has(slug); n++) slug = `${voucher.slug.slice(0, 50)}-copy-${n}`;
  // Everything except the identity, the timestamps and the archive mark.
  const { id: _id, created_at: _created, updated_at: _updated, archived_at: _archived, ...copy } = voucher;
  const { data, error } = await supabase.from("digital_vouchers").insert({
    ...copy, slug, name: `${voucher.name} (copy)`.slice(0, 120), published: false, archived_at: null, created_by: userId, updated_by: userId,
  }).select("id").single();
  if (error) return failed("The voucher could not be duplicated. Try again.");
  changed(data.id);
  return { ok: true, value: { id: data.id } };
}

// Archiving takes the voucher off the public API (410 "archived"); passes already saved stay in the wallets
// until their end date. Restoring brings it back as it was.
export async function setArchived(id: string, archived: boolean): Promise<ActionResult> {
  const { supabase, userId } = await requireRole(voucherRoles);
  if (!uuid.test(id)) return failed();
  const { error } = await supabase.from("digital_vouchers")
    .update({ archived_at: archived ? new Date().toISOString() : null, updated_at: new Date().toISOString(), updated_by: userId }).eq("id", id);
  if (error) return failed(archived ? "The voucher could not be archived." : "The voucher could not be restored.");
  changed(id);
  return { ok: true, value: undefined };
}

// Sends the class and the shared object to Google again, even if nothing changed.
export async function syncWallet(id: string): Promise<ActionResult<{ classId: string; objectId: string }>> {
  const { supabase } = await requireRole(voucherRoles);
  if (!uuid.test(id)) return failed();
  const voucher = await loadVoucher(supabase, id);
  if (!voucher) return failed("The voucher no longer exists. Reload the page.");
  if (!voucher.google_wallet_enabled) return failed("Turn on Google Wallet for this voucher first (Distribution).");
  const result = await syncGoogleWallet(supabase, voucher, true);
  changed(id);
  if (!result.ok) return failed(result.error);
  return { ok: true, value: result.ids };
}

export async function testWalletConnection(): Promise<ActionResult<{ message: string }>> {
  await requireRole(voucherRoles);
  const result = await testGoogleWallet();
  return result.ok ? { ok: true, value: { message: result.message } } : failed(result.message);
}

// An image uploaded in the form and then replaced or cancelled: removed if no voucher uses it.
export async function discardUpload(path: string): Promise<ActionResult> {
  const { supabase } = await requireRole(voucherRoles);
  if (!imagePattern.test(String(path))) return failed();
  await removeImageIfUnused(supabase, path);
  return { ok: true, value: undefined };
}

// An Add to Google Wallet link for managers to try the pass (also for drafts and scheduled vouchers): it
// brings the resources up to date first. Nothing is recorded in the analytics.
export async function testSaveLink(id: string): Promise<ActionResult<{ saveUrl: string; qrSvg: string }>> {
  const { supabase } = await requireRole(voucherRoles);
  if (!uuid.test(id)) return failed();
  const voucher = await loadVoucher(supabase, id);
  if (!voucher) return failed("The voucher no longer exists. Reload the page.");
  if (!voucher.google_wallet_enabled) return failed("Turn on Google Wallet for this voucher first (Distribution).");
  const result = await syncGoogleWallet(supabase, voucher);
  changed(id);
  if (!result.ok) return failed(result.error);
  const saveUrl = googleSaveUrl(result.ids, allowedOrigins(voucher));
  if (!saveUrl) return failed("Google Wallet is not configured.");
  const qrSvg = await QRCode.toString(saveUrl, { type: "svg", errorCorrectionLevel: "L", margin: 2 });
  return { ok: true, value: { saveUrl, qrSvg } };
}
