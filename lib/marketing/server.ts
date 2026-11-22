import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { effectiveRole, marketingRoles } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import type { EventColor, MarketingEvent, MarketingLane } from "./calendar";

// Server side of the communication calendar: access check for route handlers, loading a year, and the
// campaign pictures in the private storage bucket.

export const calendarImagesBucket = "marketing-calendar-images";
const imagePattern = /^events\/[0-9a-f-]{36}\.(jpg|png)$/;

type Client = SupabaseClient<Database>;

// Route handlers cannot redirect like pages; they get null and answer 403. Same roles as
// requireRole(marketingRoles), including the admin's dev-mode preview of another role.
export async function marketingAccess(): Promise<{ supabase: Client; userId: string } | null> {
  const supabase = await createClient();
  const { data: authData } = await supabase.auth.getClaims();
  const userId = authData?.claims?.sub;
  if (!userId) return null;
  const { data: profile } = await supabase.from("app_users").select("role,active").eq("id", userId).maybeSingle();
  if (!profile?.active) return null;
  const role = await effectiveRole(profile.role);
  return marketingRoles.includes(role) ? { supabase, userId } : null;
}

const eventColumns = "id,lane_id,title,start_date,end_date,dates_tbc,show_dates,notes,image_path";

// All categories and the events that touch the year.
export async function loadCalendar(supabase: Client, year: number) {
  const [lanes, events] = await Promise.all([
    supabase.from("marketing_lanes").select("id,name,subtitle,color,show_images,position").order("position"),
    supabase.from("marketing_events").select(eventColumns).lte("start_date", `${year}-12-31`).gte("end_date", `${year}-01-01`).order("start_date"),
  ]);
  if (lanes.error || events.error) return null;
  return {
    lanes: (lanes.data ?? []).map(lane => ({ ...lane, color: lane.color as EventColor })) as MarketingLane[],
    events: (events.data ?? []) as MarketingEvent[],
  };
}

// Every year that has at least one event (for the year switcher and the default year).
export async function yearsWithEvents(supabase: Client) {
  const { data } = await supabase.from("marketing_events").select("start_date,end_date");
  const years = new Set<number>();
  for (const row of data ?? []) for (let y = Number(row.start_date.slice(0, 4)); y <= Number(row.end_date.slice(0, 4)); y++) years.add(y);
  return [...years];
}

export function isImagePath(path: string) {
  return imagePattern.test(path);
}

// Removes a stored picture once no event uses it any more.
export async function removeImageIfUnused(supabase: Client, path: string | null) {
  if (!path || !imagePattern.test(path)) return;
  const { count } = await supabase.from("marketing_events").select("id", { count: "exact", head: true }).eq("image_path", path);
  if (count === 0) await supabase.storage.from(calendarImagesBucket).remove([path]);
}

// ---- Share link ------------------------------------------------------------------------------------------

const tokenPattern = /^[A-Za-z0-9_-]{32,64}$/;

export function isShareToken(token: string) {
  return tokenPattern.test(token);
}

// The shared (read-only) calendar: whoever has a valid link sees the board, without an account. Read on the
// server with the service client, only after the token matches the one an editor created.
export async function sharedCalendarClient(token: string): Promise<Client | null> {
  if (!tokenPattern.test(token)) return null;
  const admin = createAdminClient();
  if (!admin) return null;
  const { data } = await admin.from("marketing_share_links").select("id").eq("token", token).maybeSingle();
  return data ? admin : null;
}
