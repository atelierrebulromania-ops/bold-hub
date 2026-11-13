// HoReCa catalogs: data shapes, the template's fixed wording per language, formatting and the page plan.
// Pure code (no server or browser APIs), shared by the editor, the PDF template and the tests.

export const catalogLanguages = {
  ro: "Română",
  es: "Español",
  en: "English",
  fr: "Français",
  it: "Italiano",
  de: "Deutsch",
} as const;
export type CatalogLanguage = keyof typeof catalogLanguages;

export const catalogCurrencies = ["RON", "EUR", "USD", "GBP", "CHF", "HUF", "BGN"] as const;

export const sizeUnits = { ml: "ml", g: "g", kg: "kg", buc: "buc." } as const;
export type SizeUnit = keyof typeof sizeUnits;

export type CatalogProduct = {
  id: string;
  collection_id: string;
  name: string;
  price: number;
  currency: string | null;
  size_value: number | null;
  size_unit: SizeUnit | null;
  sku: string | null;
  image_path: string | null;
  position: number;
  active: boolean;
};

export type CatalogCollection = {
  id: string;
  label: string;
  name: string;
  position: number;
  active: boolean;
};

export type CatalogData = {
  id: string;
  title: string;
  language: CatalogLanguage;
  currency: string;
  cover_title: string;
  cover_subtitle: string;
  website: string;
  terms_vat: string | null;
  terms_currency: string | null;
  terms_payment: string | null;
  terms_delivery: string | null;
  terms_other: string | null;
  // Percent off every product's price when the catalog is shown; 0 = no discount.
  discount_percent: number;
  collections: CatalogCollection[];
  products: CatalogProduct[];
};

// The fixed wording printed by the template. Only these labels follow the catalog's language; the
// texts the user writes (names, terms) are printed as entered.
type Wording = { price: string; volume: string; weight: string; units: string; code: string };
export const templateWording: Record<CatalogLanguage, Wording> = {
  ro: { price: "PREȚ:", volume: "VOLUM:", weight: "GRAMAJ:", units: "BUCĂȚI:", code: "COD:" },
  es: { price: "PRECIO:", volume: "VOLUMEN:", weight: "PESO:", units: "UNIDADES:", code: "CÓD.:" },
  en: { price: "PRICE:", volume: "VOLUME:", weight: "WEIGHT:", units: "UNITS:", code: "CODE:" },
  fr: { price: "PRIX :", volume: "VOLUME :", weight: "POIDS :", units: "UNITÉS :", code: "RÉF. :" },
  it: { price: "PREZZO:", volume: "VOLUME:", weight: "PESO:", units: "PEZZI:", code: "COD.:" },
  de: { price: "PREIS:", volume: "VOLUMEN:", weight: "GEWICHT:", units: "STÜCK:", code: "ART.-NR.:" },
};

// Suggested texts when a catalog is created; they stay editable per catalog.
export const defaultCatalogTexts: Record<CatalogLanguage, { cover_subtitle: string; label: string; terms_vat: string; terms_payment: string }> = {
  ro: { cover_subtitle: "LISTĂ DE PREȚURI", label: "COLECȚIA SIGNATURE", terms_vat: "Prețurile nu includ TVA.", terms_payment: "Plata se face prin transfer bancar." },
  es: { cover_subtitle: "LISTA DE PRECIOS", label: "COLECCIÓN SIGNATURE", terms_vat: "Los precios no incluyen IVA.", terms_payment: "El pago se realizará mediante Transferencia Bancaria a la entrega del producto." },
  en: { cover_subtitle: "PRICE LIST", label: "SIGNATURE COLLECTION", terms_vat: "Prices do not include VAT.", terms_payment: "Payment by bank transfer." },
  fr: { cover_subtitle: "LISTE DE PRIX", label: "COLLECTION SIGNATURE", terms_vat: "Les prix ne comprennent pas la TVA.", terms_payment: "Paiement par virement bancaire." },
  it: { cover_subtitle: "LISTINO PREZZI", label: "COLLEZIONE SIGNATURE", terms_vat: "I prezzi non includono l'IVA.", terms_payment: "Pagamento tramite bonifico bancario." },
  de: { cover_subtitle: "PREISLISTE", label: "SIGNATURE KOLLEKTION", terms_vat: "Die Preise verstehen sich ohne MwSt.", terms_payment: "Zahlung per Banküberweisung." },
};

const currencySymbols: Record<string, { symbol: string; before: boolean }> = {
  EUR: { symbol: "€", before: false },
  RON: { symbol: " LEI", before: false },
  USD: { symbol: "$", before: true },
  GBP: { symbol: "£", before: true },
  CHF: { symbol: " CHF", before: false },
};

// As in the reference catalog: "6.59€" (two decimals, dot separator).
export function formatPrice(price: number, currency: string) {
  const amount = price.toFixed(2);
  const sign = currencySymbols[currency] ?? { symbol: ` ${currency}`, before: false };
  return sign.before ? `${sign.symbol}${amount}` : `${amount}${sign.symbol}`;
}

// The price after the catalog's discount, rounded to cents (computed on cents to avoid float drift).
export function discountedPrice(price: number, percent: number) {
  if (!(percent > 0)) return price;
  return Math.round(Math.round(price * 100) * (100 - percent) / 100) / 100;
}

// "10%", "12.5%"
export function formatPercent(percent: number) {
  return `${Number.isInteger(percent) ? percent : String(percent).replace(/0+$/, "")}%`;
}

export function formatSize(value: number | null, unit: SizeUnit | null) {
  if (value === null || unit === null) return null;
  const amount = Number.isInteger(value) ? String(value) : String(value).replace(/\.?0+$/, "");
  return `${amount}${unit === "buc" ? " BUC." : unit.toUpperCase()}`;
}

export function sizeLabel(unit: SizeUnit | null, language: CatalogLanguage) {
  const wording = templateWording[language];
  if (unit === "g" || unit === "kg") return wording.weight;
  if (unit === "buc") return wording.units;
  return wording.volume;
}

// Atelier_Rebul_HoReCa_ES_2026-11-10.pdf
export function pdfFileName(language: CatalogLanguage, date: Date) {
  const day = date.toLocaleDateString("sv-SE", { timeZone: "Europe/Bucharest" });
  return `Atelier_Rebul_HoReCa_${language.toUpperCase()}_${day}.pdf`;
}

export function termsOf(catalog: Pick<CatalogData, "terms_vat" | "terms_currency" | "terms_payment" | "terms_delivery" | "terms_other">) {
  return [catalog.terms_vat, catalog.terms_currency, catalog.terms_payment, catalog.terms_delivery, catalog.terms_other]
    .map(text => text?.trim() ?? "").filter(Boolean);
}

// ---------------------------------------------------------------------------------------------------
// Page plan. The template is fixed: a product page holds up to `cardsPerPage` cards in rows of two; an
// odd last card is centred, as in the reference. Cards never split across pages, every collection
// starts with its own title page, and inactive collections or products are left out.

export const cardsPerPage = 8;

export type PlannedPage =
  | { kind: "cover" }
  | { kind: "terms"; terms: string[] }
  | { kind: "collection"; collection: CatalogCollection }
  | { kind: "products"; collection: CatalogCollection; rows: CatalogProduct[][]; continued: boolean }
  | { kind: "back" };

export function planCatalog(catalog: CatalogData): PlannedPage[] {
  const pages: PlannedPage[] = [{ kind: "cover" }, { kind: "terms", terms: termsOf(catalog) }];
  const collections = catalog.collections.filter(collection => collection.active)
    .sort((a, b) => a.position - b.position || a.name.localeCompare(b.name));
  for (const collection of collections) {
    const products = catalog.products
      .filter(product => product.active && product.collection_id === collection.id)
      .sort((a, b) => a.position - b.position || a.name.localeCompare(b.name));
    if (products.length === 0) continue;
    pages.push({ kind: "collection", collection });
    for (let start = 0; start < products.length; start += cardsPerPage) {
      const chunk = products.slice(start, start + cardsPerPage);
      const rows: CatalogProduct[][] = [];
      for (let index = 0; index < chunk.length; index += 2) rows.push(chunk.slice(index, index + 2));
      pages.push({ kind: "products", collection, rows, continued: start > 0 });
    }
  }
  pages.push({ kind: "back" });
  return pages;
}
