"use server";

import { revalidatePath } from "next/cache";
import { saveClient, type ClientInput } from "@/app/account/actions";
import { requireRole, staffRoles } from "@/lib/auth";
import type { Json } from "@/lib/database.types";
import { normalizeLead } from "@/lib/leads";

type Result = { ok: boolean; message: string };

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type LeadActivity = { id: string; kind: string; body: string | null; created_at: string; user_name: string | null };

// Agents with CRM access work leads; the admin can too (also while previewing another role).
async function worker() {
  const context = await requireRole(staffRoles);
  const canWork = context.profile.crm && (context.profile.role === "admin" || context.profile.role === "account");
  return { ...context, canWork };
}

function done<T extends Result>(result: T): T {
  revalidatePath("/crm");
  return result;
}

export async function getLeadActivity(leadId: string): Promise<LeadActivity[]> {
  const { supabase, profile } = await requireRole(staffRoles);
  if (!profile.crm || !uuid.test(leadId)) return [];
  const [{ data: rows }, { data: people }] = await Promise.all([
    supabase.from("lead_activities").select("id,kind,body,created_at,user_id").eq("lead_id", leadId).order("created_at", { ascending: false }).limit(200),
    supabase.rpc("crm_people"),
  ]);
  const names = new Map((people ?? []).map((person) => [person.id, person.full_name]));
  return (rows ?? []).map((row) => ({ id: row.id, kind: row.kind, body: row.body, created_at: row.created_at, user_name: row.user_id ? names.get(row.user_id) ?? null : null }));
}

export async function claimLead(leadId: string): Promise<Result> {
  const { supabase, canWork } = await worker();
  if (!canWork || !uuid.test(leadId)) return { ok: false, message: "Doar agenții cu acces la Lead pot prelua lead-uri." };
  const { data } = await supabase.rpc("claim_lead", { p_id: leadId });
  return done(data ? { ok: true, message: "Lead-ul e al tău." } : { ok: false, message: "Lead-ul a fost preluat între timp de altcineva." });
}

export async function releaseLead(leadId: string): Promise<Result> {
  const { supabase, canWork } = await worker();
  if (!canWork || !uuid.test(leadId)) return { ok: false, message: "Nu ai acces." };
  const { data } = await supabase.rpc("release_lead", { p_id: leadId });
  return done(data ? { ok: true, message: "Lead-ul a revenit în lista comună." } : { ok: false, message: "Doar cine a preluat lead-ul îl poate elibera." });
}

export async function setLeadStatus(leadId: string, status: string, reason: string): Promise<Result> {
  const { supabase, canWork } = await worker();
  if (!canWork || !uuid.test(leadId)) return { ok: false, message: "Nu ai acces." };
  if (status === "lost" && !reason.trim()) return { ok: false, message: "Alege motivul pentru care lead-ul e pierdut." };
  const { data, error } = await supabase.rpc("set_lead_status", { p_id: leadId, p_status: status, p_reason: reason });
  if (error) return { ok: false, message: "Etapa nu este validă." };
  return done(data ? { ok: true, message: "Etapa a fost schimbată." } : { ok: false, message: "Doar cine a preluat lead-ul îi poate schimba etapa." });
}

export async function addLeadNote(leadId: string, body: string): Promise<Result> {
  const { supabase, canWork } = await worker();
  if (!canWork || !uuid.test(leadId)) return { ok: false, message: "Nu ai acces." };
  if (!body.trim() || body.length > 4000) return { ok: false, message: "Scrie notița (maximum 4000 de caractere)." };
  const { data } = await supabase.rpc("add_lead_note", { p_id: leadId, p_body: body });
  return done(data ? { ok: true, message: "Notița a fost salvată." } : { ok: false, message: "Lead-ul nu mai există." });
}

export type ManualLead = { full_name: string; company: string; phone: string; email: string; city: string; message: string };

export async function createLead(input: ManualLead): Promise<Result & { id?: string }> {
  const { supabase, canWork } = await worker();
  if (!canWork) return { ok: false, message: "Doar agenții cu acces la Lead pot adăuga lead-uri." };
  if (!input.full_name.trim() && !input.company.trim()) return { ok: false, message: "Completează numele sau firma." };
  const { data, error } = await supabase.rpc("create_lead", { p_lead: input as unknown as Json });
  if (error || !data) return { ok: false, message: "Nu am putut salva lead-ul." };
  return { ...done({ ok: true, message: "Lead-ul a fost adăugat." }), id: data };
}

// CSV from Meta Leads Center (or any sheet with a header row). Rows already imported are skipped.
export async function importLeads(rows: Record<string, string>[], source: "meta" | "website"): Promise<Result> {
  const { supabase, canWork } = await worker();
  if (!canWork) return { ok: false, message: "Doar agenții cu acces la Lead pot importa lead-uri." };
  if (!Array.isArray(rows) || rows.length === 0 || rows.length > 2000) return { ok: false, message: "Fișierul trebuie să aibă între 1 și 2000 de rânduri." };
  let added = 0;
  let skipped = 0;
  for (const row of rows) {
    const lead = normalizeLead(row, source);
    if (!lead) { skipped++; continue; }
    const { data } = await supabase.rpc("create_lead", { p_lead: { ...lead, source: "import" } as unknown as Json });
    if (data) added++; else skipped++;
  }
  return done({ ok: true, message: `${added} lead-uri importate${skipped ? `, ${skipped} sărite (deja existente sau fără date de contact)` : ""}.` });
}

// Won: the lead becomes one of the agent's clients (same form as Clienți), and is linked to it.
export async function convertLead(leadId: string, client: ClientInput): Promise<Result & { clientId?: string }> {
  const { supabase, canWork } = await worker();
  if (!canWork || !uuid.test(leadId)) return { ok: false, message: "Nu ai acces." };
  const saved = await saveClient(null, client);
  if (!saved.ok || !saved.id) return saved;
  const { data } = await supabase.rpc("link_lead_client", { p_id: leadId, p_partner_id: saved.id });
  revalidatePath("/account");
  return done(data ? { ok: true, message: "Lead câștigat: clientul a fost creat.", clientId: saved.id }
    : { ok: false, message: "Clientul a fost creat, dar lead-ul nu a putut fi marcat câștigat (e preluat de alt agent)." });
}
