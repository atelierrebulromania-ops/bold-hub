import { listBocpInvoices } from "./invoices";
import { listBocpOrders } from "./orders";

export const BOCP_LAUNCH_DATE = "2026-10-01";
export const BOCP_EARLIEST_AUDIT_DATE = "2026-09-01";
const MAX_PAGES_PER_FEED = 8;

type ListPage = { rows: unknown[]; nextPage: number | null };

export function validDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function daysBefore(value: string, days: number): string {
  const date = new Date(`${value}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString().slice(0, 10);
}

async function collectPages(list: (page: number) => Promise<ListPage>) {
  const rows: unknown[] = [];
  let page = 1;
  for (let fetched = 0; fetched < MAX_PAGES_PER_FEED; fetched++) {
    const result = await list(page);
    rows.push(...result.rows);
    if (result.nextPage === null) return { rows, pages: fetched + 1, truncated: false };
    if (result.nextPage <= page) throw new Error("BOCP returned invalid pagination.");
    page = result.nextPage;
  }
  return { rows, pages: MAX_PAGES_PER_FEED, truncated: true };
}

export async function readBocpFeeds(invoiceFrom: string) {
  const orderFrom = daysBefore(invoiceFrom, 30);
  const [orders, invoices] = await Promise.all([
    collectPages(page => listBocpOrders({ dateFrom: orderFrom, page })),
    collectPages(page => listBocpInvoices({ dateFrom: invoiceFrom, page })),
  ]);
  return { orderFrom, orders, invoices, complete: !orders.truncated && !invoices.truncated };
}
