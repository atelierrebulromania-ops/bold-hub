import type { Metadata } from "next";
import { CalendarSheet, PrintButton, YearNav } from "@/app/marketing/board";
import { pickYear } from "@/lib/marketing/calendar";
import { loadCalendar, sharedCalendarClient, yearsWithEvents } from "@/lib/marketing/server";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Global communication calendar · Atelier Rebul", robots: { index: false, follow: false } };

// The calendar shared by link: the board only, read-only, no account. The token is checked on every request.
export default async function SharedCalendarPage({ params, searchParams }: {
  params: Promise<{ token: string }>; searchParams: Promise<{ year?: string }>;
}) {
  const { token } = await params;
  const client = await sharedCalendarClient(token);
  if (!client) {
    return <main className="mk-share-page"><p className="mk-share-missing">This link is no longer valid. Ask for a new one.</p></main>;
  }
  const today = new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Bucharest" });
  const { years, laneRows } = await yearsWithEvents(client);
  const year = pickYear((await searchParams).year, Number(today.slice(0, 4)), years);
  const calendar = await loadCalendar(client, year);
  const base = `/share/calendar/${encodeURIComponent(token)}`;

  return (
    <main className="mk-share-page mk-page">
      <div className="mk-toolbar">
        <YearNav year={year} base={`${base}?year=`} />
        <div className="mk-share-actions-bar">
          <span className="mk-share-badge">Preview · read-only</span>
          {calendar && <PrintButton />}
        </div>
      </div>
      {calendar
        ? <CalendarSheet year={year} today={today} lanes={calendar.lanes} events={calendar.events} laneRows={laneRows} imageBase={`${base}/image?path=`} />
        : <p className="mk-share-missing">The calendar could not be loaded. Reload the page.</p>}
    </main>
  );
}
