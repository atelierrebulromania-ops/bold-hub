// Everything the client file shows, for the agent's and the admin's client pages.
export const clientFileSelect = `id,business_name,location_name,type,contact_phone,contact_email,is_important_client,active,auth_user_id,account_username,account_id,bocp_contact_id,
  billing_name,vat_id,registration_number,billing_street,billing_city,billing_county,billing_zip,
  own_consumption_discounts,sales_mode,consignment_commission,partner_discounts(category,percent,channel),
  stock_mode,partner_locations(id,name,city,address,contact_name,contact_phone,is_main,active,account_username),
  partner_par_levels(product_id,location_id,channel,par_level_quantity,products(name,sku)),
  partner_contracts(id,title,status,supplier_uploaded_at,signed_uploaded_at),
  partner_custody_items(id,location_id,kind,product_id,name,quantity,unit_value,handed_on,trial_ends_on,status,closed_on,note,document_number),
  partner_carts(id,status,created_at,prepared_at,delivered_at,invoiced_at,invoice_number,bocp_invoice_id,invoice_due_date,invoice_rest,partner_cart_items(quantity_needed))`;

const tabIds = ["date", "puncte", "regim", "stoc", "custodie", "cerere", "cont", "admin"] as const;
export type ClientTabId = (typeof tabIds)[number];
export function clientTab(value: string | undefined): ClientTabId {
  return tabIds.includes(value as ClientTabId) ? value as ClientTabId : "date";
}

// Product categories for the discount rules (computed on the server, passed to the client file).
export function productCategories(catalog: { category: string | null }[]) {
  return [...new Set(catalog.map((item) => item.category).filter((value): value is string => !!value))].sort((a, b) => a.localeCompare(b, "ro"));
}
