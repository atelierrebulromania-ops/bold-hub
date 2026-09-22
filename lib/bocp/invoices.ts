import { bocpGetList, type BocpListPage } from "./client";

export type BocpInvoicePage = BocpListPage;

export function listBocpInvoices(options: { page?: number; modifiedAfter?: string } = {}): Promise<BocpInvoicePage> {
  return bocpGetList("invoices/list", { page: options.page ?? 1, modifiedAfter: options.modifiedAfter });
}
