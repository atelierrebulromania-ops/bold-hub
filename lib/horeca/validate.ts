// Validation of what users type in the catalog editor. Pure, so the server actions and the tests share it.
// Messages are in Romanian and name the field, for people without technical knowledge.
import { catalogLanguages, sizeUnits, type CatalogLanguage, type SizeUnit } from "./catalog.ts";

export type FieldErrors = Record<string, string>;
export type Parsed<T> = { ok: true; value: T } | { ok: false; errors: FieldErrors };

const text = (value: unknown) => (typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "");
const multiline = (value: unknown) => (typeof value === "string" ? value.replace(/\r\n/g, "\n").trim() : "");

// Accepts "6.59", "6,59" and "1 250,50".
export function parseAmount(value: unknown): number | null {
  const raw = text(value).replace(/\s/g, "");
  if (!/^\d+([.,]\d{1,2})?$/.test(raw)) return null;
  return Number(raw.replace(",", "."));
}

export type ProductInput = {
  name: string; collectionId: string; price: number; currency: string | null;
  sizeValue: number | null; sizeUnit: SizeUnit | null; sku: string | null; imagePath: string | null; active: boolean;
};

export function parseProduct(input: Record<string, unknown>): Parsed<ProductInput> {
  const errors: FieldErrors = {};
  const name = text(input.name);
  if (!name) errors.name = "Scrie denumirea produsului.";
  else if (name.length > 80) errors.name = "Denumirea poate avea cel mult 80 de caractere.";
  const collectionId = text(input.collectionId);
  if (!/^[0-9a-f-]{36}$/i.test(collectionId)) errors.collectionId = "Alege colecția.";
  const price = parseAmount(input.price);
  if (price === null) errors.price = "Scrie prețul ca număr, de exemplu 6.59.";
  else if (price >= 1_000_000_000) errors.price = "Prețul este prea mare.";
  const currencyRaw = text(input.currency).toUpperCase();
  const currency = currencyRaw ? currencyRaw : null;
  if (currency && !/^[A-Z]{3}$/.test(currency)) errors.currency = "Moneda are 3 litere, de exemplu EUR.";
  const sizeText = text(input.sizeValue);
  const unitRaw = text(input.sizeUnit);
  let sizeValue: number | null = null;
  let sizeUnit: SizeUnit | null = null;
  if (sizeText) {
    sizeValue = parseAmount(sizeText);
    if (sizeValue === null || sizeValue <= 0) errors.sizeValue = "Scrie gramajul sau volumul ca număr, de exemplu 550.";
    if (!(unitRaw in sizeUnits)) errors.sizeUnit = "Alege unitatea de măsură.";
    else sizeUnit = unitRaw as SizeUnit;
  }
  const sku = text(input.sku) || null;
  if (sku && sku.length > 40) errors.sku = "Codul poate avea cel mult 40 de caractere.";
  const imagePath = text(input.imagePath) || null;
  return Object.keys(errors).length
    ? { ok: false, errors }
    : { ok: true, value: { name, collectionId, price: price as number, currency, sizeValue, sizeUnit, sku, imagePath, active: input.active !== false } };
}

export type CatalogInfoInput = {
  title: string; language: CatalogLanguage; currency: string; coverTitle: string; coverSubtitle: string; website: string;
  termsVat: string | null; termsCurrency: string | null; termsPayment: string | null; termsDelivery: string | null; termsOther: string | null;
};

export function parseCatalogInfo(input: Record<string, unknown>): Parsed<CatalogInfoInput> {
  const errors: FieldErrors = {};
  const title = text(input.title);
  if (!title) errors.title = "Scrie titlul catalogului.";
  else if (title.length > 120) errors.title = "Titlul poate avea cel mult 120 de caractere.";
  const language = text(input.language);
  if (!(language in catalogLanguages)) errors.language = "Alege limba catalogului.";
  const currency = text(input.currency).toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) errors.currency = "Alege moneda catalogului.";
  const coverTitle = text(input.coverTitle);
  if (coverTitle.length > 40) errors.coverTitle = "Titlul de pe copertă poate avea cel mult 40 de caractere.";
  const coverSubtitle = text(input.coverSubtitle);
  if (coverSubtitle.length > 60) errors.coverSubtitle = "Subtitlul poate avea cel mult 60 de caractere.";
  const website = text(input.website);
  if (website.length > 80) errors.website = "Adresa site-ului poate avea cel mult 80 de caractere.";
  const terms = {} as Record<"termsVat" | "termsCurrency" | "termsPayment" | "termsDelivery" | "termsOther", string | null>;
  for (const key of ["termsVat", "termsCurrency", "termsPayment", "termsDelivery", "termsOther"] as const) {
    const value = multiline(input[key]);
    if (value.length > 600) errors[key] = "Textul poate avea cel mult 600 de caractere.";
    terms[key] = value || null;
  }
  return Object.keys(errors).length
    ? { ok: false, errors }
    : { ok: true, value: { title, language: language as CatalogLanguage, currency, coverTitle, coverSubtitle, website, ...terms } };
}

export function parseCollection(input: Record<string, unknown>): Parsed<{ name: string; label: string }> {
  const name = text(input.name);
  const label = text(input.label);
  const errors: FieldErrors = {};
  if (!name) errors.name = "Scrie numele colecției.";
  else if (name.length > 60) errors.name = "Numele poate avea cel mult 60 de caractere.";
  if (label.length > 60) errors.label = "Textul de deasupra poate avea cel mult 60 de caractere.";
  return Object.keys(errors).length ? { ok: false, errors } : { ok: true, value: { name, label } };
}
