import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { bocpGetList } from "@/lib/bocp/client";
import { sendConnectorOrder } from "@/lib/bocp/connector";
import type { Database } from "@/lib/database.types";

type Client = SupabaseClient<Database>;

export type BocpStock = { price: number; priceWithVat: number; vatPercent: number; global: number; reserved: number; available: number };

const MAX_PAGES = 10;

function number(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

// Prices and stock for the given product codes, read from the BOCP product list (GET).
export async function bocpProductStock(codes: Iterable<string>): Promise<Map<string, BocpStock>> {
  const wanted = new Set(codes);
  const found = new Map<string, BocpStock>();
  let page: number | null = 1;
  for (let fetched = 0; page !== null && fetched < MAX_PAGES && found.size < wanted.size; fetched++) {
    const result = await bocpGetList("product/list", { page });
    for (const raw of result.rows) {
      const row = raw as Record<string, unknown>;
      const code = typeof row.cod_produs === "string" ? row.cod_produs.trim() : "";
      if (!wanted.has(code) || found.has(code)) continue;
      found.set(code, {
        price: number(row.pret_vanzare), priceWithVat: number(row.pret_vanzare_cu_tva), vatPercent: number(row.cota_tva_vanzare),
        global: number(row.stoc_global), reserved: number(row.stock_reserved), available: number(row.stock_available),
      });
    }
    page = result.nextPage;
  }
  return found;
}

function bucharestDay() {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Bucharest" }).format(new Date());
}

// Sends a prepared B2B cart to BOCP as a connector order, which reserves its stock there, and
// records the outcome on the cart. The order id is the cart id, so a retry never duplicates it.
export async function reserveCartInBocp(supabase: Client, cartId: string): Promise<{ ok: boolean; message: string }> {
  const { data: cart } = await supabase.from("partner_carts")
    .select("id,status,reserved_in_bocp_at,sales_documents!partner_carts_source_document_id_fkey(kind,status,bocp_order_id,sales_document_items(sku,quantity)),partners(business_name,location_name,contact_phone,contact_email,billing_name,vat_id,registration_number,billing_street,billing_city,billing_county,billing_zip,billing_country),partner_cart_items(quantity_needed,products(sku,name))")
    .eq("id", cartId).maybeSingle();
  if (!cart || !["prepared", "delivered"].includes(cart.status)) return { ok: false, message: "Coșul nu mai este pe raft. Reîncarcă pagina." };
  if (cart.reserved_in_bocp_at) return { ok: true, message: "Coșul este deja rezervat în BOCP." };

  const record = async (bocpOrderId: string | null, error: string | null) => {
    await supabase.rpc("record_partner_cart_bocp_order", { p_cart_id: cartId, p_bocp_order_id: bocpOrderId, p_error: error });
  };
  const fail = async (error: string) => { await record(null, error); return { ok: false, message: error }; };

  const partner = cart.partners;
  if (!partner) return fail("Partenerul coșului nu mai există.");
  const address = { street: partner.billing_street ?? "", city: partner.billing_city ?? "", county: partner.billing_county ?? "", zip: partner.billing_zip ?? "", country: partner.billing_country || "Romania" };
  if (!partner.vat_id?.trim()) {
    return fail(`${partner.business_name} nu are CUI. Completează datele de facturare în Administrare → Revânzători.`);
  }
  if (!address.street || !address.city || !address.county) {
    return fail(`${partner.business_name} nu are adresa de facturare completă (stradă, oraș, județ). Completeaz-o în Administrare → Revânzători.`);
  }

  const lines = new Map<string, { name: string; quantity: number }>();
  for (const item of cart.partner_cart_items) {
    if (!item.products?.sku) continue;
    const line = lines.get(item.products.sku) ?? { name: item.products.name, quantity: 0 };
    line.quantity += item.quantity_needed;
    lines.set(item.products.sku, line);
  }
  if (!lines.size) return fail("Coșul nu are produse.");

  // A cart made from a proforma: the proforma's own BOCP order already reserves its products, so
  // only what the cart holds beyond them needs a new order.
  const proforma = cart.sales_documents?.kind === "proforma" && cart.sales_documents.status === "issued" ? cart.sales_documents : null;
  if (proforma?.bocp_order_id) {
    for (const item of proforma.sales_document_items) {
      const line = lines.get(item.sku);
      if (!line) continue;
      line.quantity -= item.quantity;
      if (line.quantity <= 0) lines.delete(item.sku);
    }
    if (!lines.size) {
      await record(proforma.bocp_order_id, null);
      return { ok: true, message: `Stocul este rezervat în BOCP prin proforma (comanda #${proforma.bocp_order_id}).` };
    }
  }

  let stock: Map<string, BocpStock>;
  try { stock = await bocpProductStock(lines.keys()); }
  catch { return fail("Nu am putut citi prețurile din BOCP. Încearcă din nou (funcționează doar de pe rețeaua permisă în BOCP)."); }
  const missing = [...lines.keys()].filter((code) => !stock.has(code));
  if (missing.length) return fail(`Produse negăsite în BOCP: ${missing.join(", ")}.`);

  const vatId = partner.vat_id?.trim() ?? "";
  const result = await sendConnectorOrder({
    orderId: `BH-${cartId}`,
    date: bucharestDay(),
    mentions: `Comandă B2B BoldHub — ${partner.business_name} (${partner.location_name})`,
    client: {
      name: partner.billing_name?.trim() || partner.business_name, isCompany: vatId.length > 0, vatId,
      registrationNumber: partner.registration_number?.trim() ?? "", phone: partner.contact_phone, email: partner.contact_email ?? "", address,
    },
    items: [...lines.entries()].map(([code, line]) => {
      const product = stock.get(code)!;
      return { code, name: line.name, quantity: line.quantity, price: product.price, priceWithVat: product.priceWithVat, vatPercent: product.vatPercent };
    }),
  });
  if (!result.ok) return fail(result.error);
  await record(result.bocpOrderId, null);
  return { ok: true, message: `Stocul este rezervat în BOCP (comanda #${result.bocpOrderId}).` };
}
