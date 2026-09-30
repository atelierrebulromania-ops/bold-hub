import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { bocpInvoiceById, type BocpInvoiceMatch } from "@/lib/bocp/invoice-lookup";
import type { Database } from "@/lib/database.types";

type Client = SupabaseClient<Database>;

// Stores an invoice's due date and what is left to pay, as BOCP has them now.
export async function recordInvoicePayment(supabase: Client, source: "cart" | "document", id: string, invoice: BocpInvoiceMatch) {
  await supabase.rpc("record_invoice_payment", {
    p_source: source, p_id: id, p_due_date: invoice.dueDate, p_total: invoice.totalAmount, p_rest: invoice.rest, p_last_payment: invoice.lastPaymentDate,
  });
}

// Re-reads unpaid B2B invoices in BOCP (not checked in the last hour), two at a time: BOCP does not
// flag an invoice as modified when a payment comes in. Returns how many were refreshed.
export async function refreshInvoicePayments(supabase: Client, limit = 20): Promise<{ checked: number; failed: number }> {
  const { data } = await supabase.rpc("invoices_to_check", { p_limit: limit });
  const due = data ?? [];
  let checked = 0;
  let failed = 0;
  for (let index = 0; index < due.length; index += 2) {
    await Promise.all(due.slice(index, index + 2).map(async (row) => {
      try {
        const invoice = await bocpInvoiceById(row.bocp_invoice_id);
        if (!invoice) { failed++; return; }
        await recordInvoicePayment(supabase, row.source === "document" ? "document" : "cart", row.id, invoice);
        checked++;
      } catch { failed++; }
    }));
  }
  return { checked, failed };
}
