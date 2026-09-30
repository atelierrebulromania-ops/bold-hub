import { paymentStatus } from "@/lib/invoice-status";

// The due date / payment state of an invoice, as a small chip.
export function PaymentChip({ dueDate, rest, audience = "staff" }: { dueDate: string | null; rest: number | null; audience?: "staff" | "partner" }) {
  const status = paymentStatus({ dueDate, rest }, audience);
  return status ? <span className={`payment-chip ${status.tone}`}>{status.label}</span> : null;
}
