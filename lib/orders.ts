export type OrderStatus = "pending" | "claimed" | "preparing" | "ready" | "handed_to_courier" | "returned";

export type OrderItem = {
  id: string;
  ean: string;
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
