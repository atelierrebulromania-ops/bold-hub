// Client discount rules: a rule for a product category wins over the rule for the whole range.
export type DiscountRule = { category: string | null; percent: number };

export function discountFor(rules: DiscountRule[], category: string | null): number {
  const byCategory = category ? rules.find((rule) => rule.category?.toLocaleLowerCase("ro") === category.toLocaleLowerCase("ro")) : undefined;
  return byCategory?.percent ?? rules.find((rule) => rule.category === null)?.percent ?? 0;
}

export const money = (value: number) => Math.round(value * 100) / 100;

export function formatMoney(value: number) {
  return new Intl.NumberFormat("ro-RO", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value);
}

export function describeRules(rules: DiscountRule[]) {
  if (!rules.length) return "Fără discount";
  return [...rules].sort((a, b) => (a.category === null ? -1 : b.category === null ? 1 : a.category.localeCompare(b.category, "ro")))
    .map((rule) => `${rule.category ?? "Toate produsele"} −${rule.percent}%`).join(" · ");
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
