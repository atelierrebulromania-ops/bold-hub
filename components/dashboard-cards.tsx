import Link from "next/link";
import { LinkPending } from "@/components/link-pending";

const number = new Intl.NumberFormat("ro-RO");

export function dayLabel(day: string) {
  return new Intl.DateTimeFormat("ro-RO", { weekday: "short", day: "2-digit", timeZone: "UTC" }).format(new Date(`${day}T12:00:00Z`));
}

export function todayLabel() {
  return new Intl.DateTimeFormat("ro-RO", { weekday: "long", day: "numeric", month: "long", timeZone: "Europe/Bucharest" }).format(new Date());
}

// "de 25 min", "de 3 h", "de 2 zile" — how long something has been waiting.
export function waitingFor(since: string | null | undefined, now: number) {
  if (!since) return null;
  const minutes = Math.max(0, Math.round((now - new Date(since).getTime()) / 60000));
  if (minutes < 60) return `de ${minutes} min`;
  if (minutes < 48 * 60) return `de ${Math.floor(minutes / 60)} h`;
  return `de ${Math.floor(minutes / 1440)} zile`;
}

export function minutes(value: number | null) {
  if (value === null) return "—";
  return value < 60 ? `${value} min` : `${Math.floor(value / 60)} h ${value % 60} min`;
}

export function ActionCard({ href, label, value, hint, alert }: { href: string; label: string; value: number | string; hint: string; alert?: boolean }) {
  return <Link href={href} className={`stat-card dashboard-stat stat-card-link${alert ? " alert" : ""}`}>
    <div><p>{label}</p><strong>{typeof value === "number" ? number.format(value) : value}</strong><small>{hint}</small></div>
    <span className="stat-card-arrow" aria-hidden="true">›</span><LinkPending />
  </Link>;
}

export function Stat({ label, value, hint }: { label: string; value: string; hint: string }) {
  return <div className="stat-card dashboard-stat"><div><p>{label}</p><strong>{value}</strong><small>{hint}</small></div></div>;
}

export function WeekChart({ days, label = "predate", mineLabel = "de tine" }: { days: { day: string; team: number; mine: number }[]; label?: string; mineLabel?: string }) {
  const max = Math.max(1, ...days.map(day => day.team));
  return (
    <div className="daily-chart-wrap week-chart">
      <div className="daily-chart" role="img" aria-label={`${label} pe zi, maximum ${max} într-o zi`}>
        <div className="daily-chart-axis" aria-hidden="true"><span>{max}</span><span>0</span></div>
        <div className="daily-chart-bars">
          {days.map(day => <div className="daily-bar-slot" key={day.day} tabIndex={0} title={`${dayLabel(day.day)}: ${day.team} ${label} · ${day.mine} ${mineLabel}`}>
            <div className="daily-bar week-bar" style={{ height: `${day.team / max * 100}%` }}>
              <div className="week-bar-mine" style={{ height: day.team ? `${day.mine / day.team * 100}%` : 0 }} />
            </div>
            <span className="daily-bar-tip" aria-hidden="true">{dayLabel(day.day)}<b>{day.team} {label}</b>{day.mine} {mineLabel}</span>
            <span className="daily-bar-label" aria-hidden="true">{dayLabel(day.day)}</span>
          </div>)}
        </div>
      </div>
    </div>
  );
}
