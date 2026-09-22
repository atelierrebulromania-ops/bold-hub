import { bocpGetList, type BocpListPage } from "./client";

export type BocpOrderPage = BocpListPage;
export type BocpConnectorPage = BocpListPage;

/** Account-wide order feed; each row can identify its originating connector. */
export function listBocpOrders(options: { page?: number; modifiedAfter?: string } = {}): Promise<BocpOrderPage> {
  return bocpGetList("marketplace/orders/list", { page: options.page ?? 1, modifiedAfter: options.modifiedAfter });
}

/** Discover connector IDs before mapping BOCP orders into BoldHub sources. */
export function listBocpConnectors(): Promise<BocpConnectorPage> {
  return bocpGetList("marketplace/connectors/list");
}
