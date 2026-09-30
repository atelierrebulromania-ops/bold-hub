// How an invoice stands against its due date. Staff see overdue warnings; partners only see the due
// date and whether it is paid.
export type PaymentStatus = { tone: "paid" | "open" | "soon" | "overdue"; label: string };

const DAY = 86_400_000;

function bucharestToday() {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Bucharest" }).format(new Date());
}

export function formatDueDate(value: string) {
  return new Intl.DateTimeFormat("ro-RO", { day: "2-digit", month: "short", year: "numeric" }).format(new Date(`${value.slice(0, 10)}T12:00:00`));
}

function money(value: number) {
  return new Intl.NumberFormat("ro-RO", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value);
}

export function paymentStatus(invoice: { dueDate: string | null; rest: number | null }, audience: "staff" | "partner"): PaymentStatus | null {
  if (invoice.rest === 0) return { tone: "paid", label: "Plătită" };
  if (!invoice.dueDate) return null;
  if (audience === "partner") return { tone: "open", label: invoice.rest === null ? `Scadentă ${formatDueDate(invoice.dueDate)}` : `Neplătită · scadentă ${formatDueDate(invoice.dueDate)}` };
  const days = Math.round((new Date(`${invoice.dueDate.slice(0, 10)}T12:00:00Z`).getTime() - new Date(`${bucharestToday()}T12:00:00Z`).getTime()) / DAY);
  const rest = invoice.rest !== null ? ` · rest ${money(invoice.rest)} lei` : "";
  if (days < 0) return { tone: "overdue", label: `Depășită cu ${-days} ${-days === 1 ? "zi" : "zile"}${rest}` };
  if (days === 0) return { tone: "soon", label: `Scadentă azi${rest}` };
  return { tone: days <= 3 ? "soon" : "open", label: `Scadentă în ${days} ${days === 1 ? "zi" : "zile"} (${formatDueDate(invoice.dueDate)})` };
}
