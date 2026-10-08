"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth";
import { refreshInvoicePayments } from "@/lib/invoice-payments";

// Re-reads the unpaid invoices in BOCP now (the daily morning job does the same in the background).
export async function recheckPayments(): Promise<{ ok: boolean; message: string }> {
  const { supabase } = await requireRole(["owner"]);
  const { checked, failed } = await refreshInvoicePayments(supabase, 30);
  revalidatePath("/dashboard/receivables");
  if (failed && !checked) return { ok: false, message: "BOCP nu a răspuns. Încearcă din nou (funcționează doar de pe rețeaua permisă în BOCP)." };
  return { ok: true, message: checked ? `Am reverificat ${checked} ${checked === 1 ? "factură" : "facturi"} în BOCP.` : "Toate facturile au fost verificate în ultima oră." };
}
