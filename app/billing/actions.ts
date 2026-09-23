"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireRole } from "@/lib/auth";

const page = "/billing";
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function markInvoiced(form: FormData) {
  const { supabase } = await requireRole(["admin", "operator_facturare"]);
  const fulfillmentId = form.get("fulfillment_id");
  const rawNumber = form.get("invoice_number");
  const invoiceNumber = typeof rawNumber === "string" ? rawNumber.trim() : "";
  if (typeof fulfillmentId !== "string" || !uuid.test(fulfillmentId) || !invoiceNumber || invoiceNumber.length > 60) {
    redirect(`${page}?error=invalid`);
  }
  const { data, error } = await supabase.rpc("mark_fulfillment_invoiced", {
    p_fulfillment_id: fulfillmentId,
    p_invoice_number: invoiceNumber,
  });
  if (error) redirect(`${page}?error=save_failed`);
  revalidatePath(page);
  redirect(data === true ? `${page}?notice=invoiced` : `${page}?error=already_done`);
}
