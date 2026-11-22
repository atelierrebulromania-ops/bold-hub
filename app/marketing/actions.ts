"use server";

import { randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";
import { marketingRoles, requireRole } from "@/lib/auth";
import { isImagePath, removeImageIfUnused } from "@/lib/marketing/server";
import { parseEvent, parseLane, type FieldErrors } from "@/lib/marketing/validate";

// Calendar actions. Each one checks the role (requireRole redirects anyone else), validates the input with
// the shared rules and writes with the user's own session, so row security applies as well.

export type ActionResult = { ok: true } | { ok: false; error: string; errors?: FieldErrors };

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const failed = (error = "Could not save. Check your internet connection and try again.") => ({ ok: false as const, error });
const invalid = (errors: FieldErrors) => ({ ok: false as const, error: "Check the highlighted fields.", errors });

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
  if (value.imagePath && !isImagePath(value.imagePath)) return invalid({ imagePath: "The picture could not be used. Upload it again." });

  const { data: lane } = await supabase.from("marketing_lanes").select("show_images").eq("id", value.laneId).maybeSingle();
  if (!lane) return invalid({ laneId: "Choose the category." });
  const current = eventId
    ? (await supabase.from("marketing_events").select("image_path").eq("id", eventId).maybeSingle()).data
    : null;
  if (eventId && !current) return failed("The event no longer exists. Reload the page.");

  const fields = {
    lane_id: value.laneId, title: value.title, start_date: value.startDate, end_date: value.endDate,
    dates_tbc: value.datesTbc, show_dates: value.showDates, notes: value.notes,
    // Pictures only where the category shows them; the colour comes from the category.
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
  if (error) return failed("The event could not be deleted. Try again.");
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
  const fields = { name: parsed.value.name, subtitle: parsed.value.subtitle, color: parsed.value.color, show_images: parsed.value.showImages, updated_at: new Date().toISOString() };
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
  if (error) return failed("The category could not be deleted. Try again.");
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
  if (results.some(result => result.error)) return failed("The order could not be saved. Reload the page.");
  changed();
  return { ok: true };
}

// ---- Share link -----------------------------------------------------------------------------------------

export type ShareResult = { ok: true; token: string | null } | { ok: false; error: string };

// A new link for the read-only calendar; the previous link stops working.
export async function createShareLink(): Promise<ShareResult> {
  const { supabase, userId } = await requireRole(marketingRoles);
  const token = randomBytes(24).toString("base64url");
  const removed = await supabase.from("marketing_share_links").delete().not("id", "is", null);
  if (removed.error) return failed("The link could not be created. Try again.");
  const { error } = await supabase.from("marketing_share_links").insert({ token, created_by: userId });
  if (error) return failed("The link could not be created. Try again.");
  return { ok: true, token };
}

// Turns sharing off: the link stops working.
export async function disableShareLink(): Promise<ShareResult> {
  const { supabase } = await requireRole(marketingRoles);
  const { error } = await supabase.from("marketing_share_links").delete().not("id", "is", null);
  if (error) return failed("Sharing could not be turned off. Try again.");
  return { ok: true, token: null };
}
