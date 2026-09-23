export type OrderStatus = "pending" | "claimed" | "preparing" | "ready" | "handed_to_courier" | "returned";

export type OrderItem = {
  id: string;
  ean: string | null;
  scan_code: string;
  scan_code_type: "sku" | "ean";
  quantity: number;
  scanned_quantity: number;
  products: { name: string; sku: string; variant_label: string | null } | null;
};

export type Order = {
  id: string;
  invoice_number: string;
  bocp_order_id: string | null;
  source: "shopify" | "marketplace";
  customer_name: string | null;
  customer_phone: string | null;
  customer_email: string | null;
  shipping_address: string | null;
  status: OrderStatus;
  claimed_by: string | null;
  invoice_pdf_url: string | null;
  created_at: string;
  online_order_items: OrderItem[];
};

export type ReturnReason = "neridicat" | "refuzat_livrare" | "produs_deteriorat" | "altul";

export const statusLabels: Record<OrderStatus, string> = {
  pending: "De preluat",
  claimed: "Preluată",
  preparing: "În pregătire",
  ready: "Pregătită",
  handed_to_courier: "Predată curierului",
  returned: "Returnată",
};

export const returnReasonLabels: Record<ReturnReason, string> = {
  neridicat: "Neridicată",
  refuzat_livrare: "Refuzată la livrare",
  produs_deteriorat: "Produs deteriorat",
  altul: "Alt motiv",
};

export type OrderSearchResult = {
  id: string;
  invoice_number: string;
  bocp_order_id: string | null;
  source: "shopify" | "marketplace";
  status: OrderStatus;
  customer_name: string | null;
  customer_email: string | null;
  customer_phone: string | null;
  shipping_address: string | null;
  created_at: string;
  claimed_at: string | null;
  released_at: string | null;
  completed_at: string | null;
  claimed_by_name: string | null;
  items: { name: string; sku: string; variant_label: string | null; quantity: number; scanned_quantity: number }[];
  return: {
    id: string;
    reason: ReturnReason;
    status: "pending_restock" | "restocked";
    registered_at: string;
    restocked_at: string | null;
    shopify_marked_manually: boolean;
  } | null;
};

export function formatDateTime(value: string | null) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("ro-RO", {
    day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Bucharest",
  }).format(new Date(value));
}
