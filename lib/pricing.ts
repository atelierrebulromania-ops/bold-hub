// Client discount rules: a rule on one product wins over the rule on the whole range (no product).
// Rules belong to an order channel (resale when missing).
export type DiscountRule = { product_id?: string | null; percent: number; channel?: string };

// The rules that apply on a channel: consumption uses the resale rules unless the client has its own.
export function channelRules(rules: DiscountRule[], channel: string = "resale", ownConsumption = false): DiscountRule[] {
  const on = channel === "consumption" && ownConsumption ? "consumption" : "resale";
  return rules.filter((rule) => (rule.channel ?? "resale") === on);
}

// The discount on a product (or on the whole range when productId is null).
export function discountFor(rules: DiscountRule[], productId: string | null): number {
  const own = productId ? rules.find((rule) => rule.product_id === productId) : undefined;
  return own?.percent ?? rules.find((rule) => !rule.product_id)?.percent ?? 0;
}

export const money = (value: number) => Math.round(value * 100) / 100;

export function formatMoney(value: number) {
  return new Intl.NumberFormat("ro-RO", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value);
}

export function describeRules(rules: DiscountRule[]) {
  if (!rules.length) return "Fără discount";
  const general = rules.find((rule) => !rule.product_id);
  const products = rules.filter((rule) => rule.product_id).length;
  return [general ? `Toate produsele −${general.percent}%` : null, products ? `${products} ${products === 1 ? "produs" : "produse"} cu discount propriu` : null]
    .filter(Boolean).join(" · ");
}

// A product's discount on an offer or proforma: its own, or the document's when it has none.
export function lineDiscount(item: { discount_percent?: number | null }, documentDiscount: number) {
  return item.discount_percent ?? documentDiscount;
}

// Totals of an offer or proforma: net lines, the discounts (per product or the document's), then VAT per line.
export function documentTotals(items: { quantity: number; unit_price: number; vat_percent: number; discount_percent?: number | null }[], discountPercent: number) {
  let net = 0;
  let discounted = 0;
  let vat = 0;
  for (const item of items) {
    const line = item.quantity * item.unit_price;
    net += line;
    const lineDiscounted = line * (1 - lineDiscount(item, discountPercent) / 100);
    discounted += lineDiscounted;
    vat += lineDiscounted * item.vat_percent / 100;
  }
  return { net: money(net), discount: money(net - discounted), subtotal: money(discounted), vat: money(vat), total: money(discounted + vat) };
}
