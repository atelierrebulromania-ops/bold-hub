"use server";

import { revalidatePath } from "next/cache";
import { marketingRoles, requireRole } from "@/lib/auth";
import { isImagePath, removeImageIfUnused } from "@/lib/marketing/server";
import { parseEvent, parseLane, type FieldErrors } from "@/lib/marketing/validate";

// Calendar actions. Each one checks the role (requireRole redirects anyone else), validates the input with
// the shared rules and writes with the user's own session, so row security applies as well.

export type ActionResult = { ok: true } | { ok: false; error: string; errors?: FieldErrors };

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const failed = (error = "Nu s-a putut salva. Verifică legătura la internet și încearcă din nou.") => ({ ok: false as const, error });
const invalid = (errors: FieldErrors) => ({ ok: false as const, error: "Verifică câmpurile marcate.", errors });

function changed() {
  revalidatePath("/marketing");
}

// ---- Events ---------------------------------------------------------------------------------------------

// Creates (eventId null) or updates an event. A picture it replaces is removed from storage.
export async function saveEvent(eventId: string | null, input: Record<string, unknown>): Promise<ActionResult> {
  const { supabase, userId } = await requireRole(marketingRoles);
  if (eventId !== null && !uuid.test(eventId)) return failed();
  const parsed = parseEvent(input);
  if (!parsed.ok) return invalid(parsed.errors);
  const value = parsed.value;
  if (value.imagePath && !isImagePath(value.imagePath)) return invalid({ imagePath: "Imaginea nu a putut fi folosită. Încarc-o din nou." });

  const { data: lane } = await supabase.from("marketing_lanes").select("kind,show_images").eq("id", value.laneId).maybeSingle();
  if (!lane) return invalid({ laneId: "Alege categoria." });
  const current = eventId
    ? (await supabase.from("marketing_events").select("image_path").eq("id", eventId).maybeSingle()).data
    : null;
  if (eventId && !current) return failed("Evenimentul nu mai există. Reîncarcă pagina.");

  const fields = {
    lane_id: value.laneId, title: value.title, start_date: value.startDate, end_date: value.endDate,
    dates_tbc: value.datesTbc, show_dates: value.showDates, color: value.color, notes: value.notes,
    // Stock-in notes only exist on the product-line band; pictures only where the category shows them.
    stock_in: lane.kind === "band" ? value.stockIn : null,
    image_path: lane.show_images ? value.imagePath : null,
    updated_at: new Date().toISOString(), updated_by: userId,
  };
  const { error } = eventId
    ? await supabase.from("marketing_events").update(fields).eq("id", eventId)
    : await supabase.from("marketing_events").insert({ ...fields, created_by: userId });
  if (error) return failed();
  if (current?.image_path && current.image_path !== fields.image_path) await removeImageIfUnused(supabase, current.image_path);
  changed();
  return { ok: true };
}

export async function deleteEvent(eventId: string): Promise<ActionResult> {
  const { supabase } = await requireRole(marketingRoles);
  if (!uuid.test(eventId)) return failed();
  const { data: event } = await supabase.from("marketing_events").select("image_path").eq("id", eventId).maybeSingle();
  const { error } = await supabase.from("marketing_events").delete().eq("id", eventId);
  if (error) return failed("Evenimentul nu a putut fi șters. Încearcă din nou.");
  await removeImageIfUnused(supabase, event?.image_path ?? null);
  changed();
  return { ok: true };
}

// A picture uploaded in the event window that was then cancelled: removed if no event uses it.
export async function discardUpload(path: string): Promise<ActionResult> {
  const { supabase } = await requireRole(marketingRoles);
  if (!isImagePath(String(path))) return failed();
  await removeImageIfUnused(supabase, path);
  return { ok: true };
}

// ---- Categories (rows of the board) -------------------------------------------------------------------

export async function saveLane(laneId: string | null, input: Record<string, unknown>): Promise<ActionResult> {
  const { supabase } = await requireRole(marketingRoles);
  if (laneId !== null && !uuid.test(laneId)) return failed();
  const parsed = parseLane(input);
  if (!parsed.ok) return invalid(parsed.errors);
  const fields = { name: parsed.value.name, subtitle: parsed.value.subtitle, kind: parsed.value.kind, show_images: parsed.value.showImages, updated_at: new Date().toISOString() };
  if (laneId) {
    const { error } = await supabase.from("marketing_lanes").update(fields).eq("id", laneId);
    if (error) return failed();
  } else {
    const { data: last } = await supabase.from("marketing_lanes").select("position").order("position", { ascending: false }).limit(1).maybeSingle();
    const { error } = await supabase.from("marketing_lanes").insert({ ...fields, position: (last?.position ?? 0) + 1 });
    if (error) return failed();
  }
  changed();
  return { ok: true };
}

// Deletes a category with its events (the database cascades), then pictures nobody uses any more.
export async function deleteLane(laneId: string): Promise<ActionResult> {
  const { supabase } = await requireRole(marketingRoles);
  if (!uuid.test(laneId)) return failed();
  const { data: events } = await supabase.from("marketing_events").select("image_path").eq("lane_id", laneId);
  const { error } = await supabase.from("marketing_lanes").delete().eq("id", laneId);
  if (error) return failed("Categoria nu a putut fi ștearsă. Încearcă din nou.");
  await Promise.all([...new Set((events ?? []).map(event => event.image_path))].map(path => removeImageIfUnused(supabase, path)));
  changed();
  return { ok: true };
}

// Swaps a category with its neighbour above (-1) or below (+1).
export async function moveLane(laneId: string, offset: number): Promise<ActionResult> {
  const { supabase } = await requireRole(marketingRoles);
  if (!uuid.test(laneId) || (offset !== 1 && offset !== -1)) return failed();
  const { data: lanes } = await supabase.from("marketing_lanes").select("id,position").order("position");
  const order = (lanes ?? []).map(lane => lane.id);
  const index = order.indexOf(laneId);
  const target = index + offset;
  if (index === -1 || target < 0 || target >= order.length) return { ok: true };
  [order[index], order[target]] = [order[target], order[index]];
  const results = await Promise.all(order.map((id, position) => supabase.from("marketing_lanes").update({ position: position + 1 }).eq("id", id)));
  if (results.some(result => result.error)) return failed("Ordinea nu a putut fi salvată. Reîncarcă pagina.");
  changed();
  return { ok: true };
}
