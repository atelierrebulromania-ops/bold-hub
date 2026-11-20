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
  const years = await yearsWithEvents(supabase);
  const year = pickYear(params.year, currentYear, years);
  const calendar = await loadCalendar(supabase, year);

  return (
    <AppShell profile={profile} active="/marketing" section="Marketing" title="Calendar comunicare"
      note={{ title: "Calendar comunicare", text: "Campaniile și evenimentele anului pe o singură planșă. Apasă pe un eveniment ca să-l modifici." }}>
      {calendar
        ? <CalendarBoard year={year} today={today} years={years} lanes={calendar.lanes} events={calendar.events} />
        : <p className="preview-alert warning admin-feedback" role="alert">Calendarul nu a putut fi încărcat. Reîncarcă pagina.</p>}
    </AppShell>
  );
}
