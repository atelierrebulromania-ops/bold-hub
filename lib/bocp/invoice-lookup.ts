import { bocpGetList } from "./client";
import { listBocpInvoices } from "./invoices";

// Finds one BOCP invoice by its number ("B2BREB-596", "B2BREB 596" or "b2breb596"), GET only.
export type BocpInvoiceMatch = {
  bocpInvoiceId: string;
  number: string;
  date: string;
  clientName: string | null;
  total: string | null;
  currency: string | null;
  cancelled: boolean;
  pdfUrl: string | null;
  dueDate: string | null;
  totalAmount: number | null;
  // What is left to pay (0 when paid).
  rest: number | null;
  lastPaymentDate: string | null;
};

const MAX_PAGES = 10;

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : typeof value === "number" ? String(value) : "";
}

function key(value: string): string {
  return value.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function pdf(value: unknown): string | null {
  try {
    const url = new URL(text(value));
    return url.protocol === "https:" && url.hostname === "secure.bocp.eu" ? url.toString() : null;
  } catch { return null; }
}

function amount(value: unknown): number | null {
  const parsed = Number(text(value));
  return text(value) !== "" && Number.isFinite(parsed) ? Math.round(parsed * 100) / 100 : null;
}

// One invoice read straight by its BOCP id (GET), e.g. to refresh what is left to pay.
export async function bocpInvoiceById(bocpInvoiceId: string): Promise<BocpInvoiceMatch | null> {
  const result = await bocpGetList("invoices/list", { id: bocpInvoiceId });
  const row = result.rows.find((raw) => raw && typeof raw === "object" && text((raw as Record<string, unknown>).bocp_id) === bocpInvoiceId);
  return row ? toMatch(row as Record<string, unknown>) : null;
}

function toMatch(row: Record<string, unknown>): BocpInvoiceMatch | null {
  const id = text(row.bocp_id);
  if (!/^[1-9][0-9]{0,18}$/.test(id)) return null;
  return {
    bocpInvoiceId: id,
    number: `${text(row.doc_series).toUpperCase()}-${text(row.doc_nr)}`,
    date: text(row.doc_date).slice(0, 10),
    clientName: text(row.client_name) || null,
    total: text(row.document_value_with_vat) || null,
    currency: text(row.currency) || null,
    cancelled: text(row.document_cancelled) === "1",
    pdfUrl: pdf(row.pdf_invoice_url),
    dueDate: /^\d{4}-\d{2}-\d{2}/.test(text(row.doc_due_date)) ? text(row.doc_due_date).slice(0, 10) : null,
    totalAmount: amount(row.document_value_with_vat),
    rest: amount(row.rest),
    lastPaymentDate: /^\d{4}-\d{2}-\d{2}/.test(text(row.last_payment_date)) ? text(row.last_payment_date).slice(0, 10) : null,
  };
}

// `issuedFrom` bounds the search (YYYY-MM-DD): invoices are listed from that date on.
export async function findBocpInvoice(number: string, issuedFrom: string, bocpInvoiceId?: string): Promise<BocpInvoiceMatch | null> {
  const wanted = key(number);
  if (!wanted && !bocpInvoiceId) return null;
  let page: number | null = 1;
  for (let fetched = 0; page !== null && fetched < MAX_PAGES; fetched++) {
    const result = await listBocpInvoices({ dateFrom: issuedFrom, page });
    for (const raw of result.rows) {
      if (!raw || typeof raw !== "object") continue;
      const row = raw as Record<string, unknown>;
      const matches = bocpInvoiceId
        ? text(row.bocp_id) === bocpInvoiceId
        : key(`${text(row.doc_series)}${text(row.doc_nr)}`) === wanted;
      if (matches) return toMatch(row);
    }
    page = result.nextPage;
  }
  return null;
}
