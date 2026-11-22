import { AppShell } from "@/components/app-shell";
import { marketingRoles, requireRole } from "@/lib/auth";
import { pickYear } from "@/lib/marketing/calendar";
import { loadCalendar, yearsWithEvents } from "@/lib/marketing/server";
import { CalendarBoard } from "./board";

export const dynamic = "force-dynamic";

export default async function MarketingCalendarPage({ searchParams }: { searchParams: Promise<{ year?: string }> }) {
  const { supabase, profile } = await requireRole(marketingRoles);
  const params = await searchParams;
  // Today's date in Romania, as YYYY-MM-DD.
  const today = new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Bucharest" });
  const currentYear = Number(today.slice(0, 4));
  const [{ years, laneRows }, share] = await Promise.all([
    yearsWithEvents(supabase),
    supabase.from("marketing_share_links").select("token").order("created_at", { ascending: false }).limit(1).maybeSingle(),
  ]);
  const year = pickYear(params.year, currentYear, years);
  const calendar = await loadCalendar(supabase, year);

  return (
    <AppShell profile={profile} active="/marketing" section="Marketing" title="Communication calendar"
      note={{ title: "Communication calendar", text: "The year's campaigns and events on one board. Click an event to edit it; Share gives a read-only link." }}>
      {calendar
        ? <CalendarBoard year={year} today={today} lanes={calendar.lanes} events={calendar.events} laneRows={laneRows} shareToken={share.data?.token ?? null} />
        : <p className="preview-alert warning admin-feedback" role="alert">The calendar could not be loaded. Reload the page.</p>}
    </AppShell>
  );
}
