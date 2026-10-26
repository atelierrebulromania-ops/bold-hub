// Accounting documents: what may be collected and how a file is recognised. Pure functions (no I/O), shared
// by the server, the tests and, for the extension list, the Capture endpoints.

export const maxDocumentBytes = 25 * 1024 * 1024;
// Files are held this long after they were collected, then deleted (metadata stays).
export const retentionDays = 30;

export type DocumentKind = "pdf" | "csv" | "xlsx";

export const kindMime: Record<DocumentKind, string> = {
  pdf: "application/pdf",
  csv: "text/csv",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
};

export const docTypes = [
  { id: "external_invoice", label: "Factură externă" },
  { id: "shopify_fees_invoice", label: "Factură comisioane Shopify Payments" },
  { id: "shopify_payout_report", label: "Raport Shopify Payout" },
  { id: "other", label: "Alt document contabil" },
] as const;

export type DocType = (typeof docTypes)[number]["id"];

export const collectionMethods = { api: "API", email: "Import email", extension: "Extensie Chrome", manual: "Manual" } as const;
export type CollectionMethod = keyof typeof collectionMethods;

export function docTypeLabel(type: string) {
  return docTypes.find((item) => item.id === type)?.label ?? type;
}

export function isDocType(value: unknown): value is DocType {
  return docTypes.some((item) => item.id === value);
}

// The kind a file name claims (by extension), before its bytes are checked.
export function kindFromName(name: string): DocumentKind | null {
  const extension = name.toLowerCase().split(".").pop();
  return extension === "pdf" || extension === "csv" || extension === "xlsx" ? extension : null;
}

function startsWith(bytes: Uint8Array, signature: number[]) {
  return signature.every((value, index) => bytes[index] === value);
}

function contains(bytes: Uint8Array, text: string, limit = bytes.length) {
  const needle = new TextEncoder().encode(text);
  const end = Math.min(limit, bytes.length) - needle.length;
  outer: for (let index = 0; index <= end; index++) {
    for (let offset = 0; offset < needle.length; offset++) if (bytes[index + offset] !== needle[offset]) continue outer;
    return true;
  }
  return false;
}

// The real kind of the bytes, checked against what the name claims. A file that is not what it says is refused.
export function detectKind(bytes: Uint8Array, name: string): { ok: true; kind: DocumentKind; mime: string } | { ok: false; error: string } {
  const claimed = kindFromName(name);
  if (!claimed) return { ok: false, error: "Sunt acceptate doar fișiere PDF, CSV și XLSX." };
  if (bytes.length === 0) return { ok: false, error: "Fișierul este gol." };
  if (bytes.length > maxDocumentBytes) return { ok: false, error: "Fișierul are peste 25 MB." };
  if (claimed === "pdf") {
    // %PDF- in the first KB (some generators put a few bytes before the header).
    if (!contains(bytes, "%PDF-", 1024)) return { ok: false, error: "Fișierul nu este un PDF valid." };
  } else if (claimed === "xlsx") {
    if (!startsWith(bytes, [0x50, 0x4b, 0x03, 0x04]) || !contains(bytes, "[Content_Types].xml")) return { ok: false, error: "Fișierul nu este un XLSX valid." };
  } else {
    const head = bytes.subarray(0, 65536);
    if (head.includes(0)) return { ok: false, error: "Fișierul nu este un CSV valid (conține date binare)." };
    try { new TextDecoder("utf-8", { fatal: true }).decode(head.length === bytes.length ? head : trimToLine(head)); }
    catch { return { ok: false, error: "Fișierul CSV trebuie să fie text UTF-8." }; }
  }
  return { ok: true, kind: claimed, mime: kindMime[claimed] };
}

// The first 64 KB of a CSV may end inside a multi-byte character: decode up to the last line break.
function trimToLine(bytes: Uint8Array) {
  const lastBreak = bytes.lastIndexOf(0x0a);
  return lastBreak > 0 ? bytes.subarray(0, lastBreak) : bytes;
}

// A safe file name for display and downloads (no paths, no control characters).
export function cleanFileName(name: string) {
  const base = name.split(/[\\/]/).pop() ?? "document";
  const cleaned = base.replace(/[\u0000-\u001f<>:"|?*]+/g, "").replace(/\s+/g, " ").trim();
  return (cleaned || "document").slice(0, 200);
}

export function isPeriod(value: string) {
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(value);
}

export function isIsoDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

// The accounting period: given by hand, else the issue date's month, else the month it was collected (Bucharest).
export function periodFor(given: string | null | undefined, issuedOn: string | null | undefined, collectedAt: Date) {
  if (given && isPeriod(given)) return given;
  if (issuedOn && isIsoDate(issuedOn)) return issuedOn.slice(0, 7);
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Bucharest", year: "numeric", month: "2-digit" }).format(collectedAt);
}

export function expiryFrom(collectedAt: Date) {
  return new Date(collectedAt.getTime() + retentionDays * 86400000);
}

export async function sha256Hex(bytes: Uint8Array) {
  const digest = await crypto.subtle.digest("SHA-256", bytes as Uint8Array<ArrayBuffer>);
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, "0")).join("");
}

export type SupplierDomains = { id: string; slug: string; name: string; domains: string[] };

// The supplier of a page, by its hostname: an exact domain or any subdomain of it. The longest match wins
// (ads.tiktok.com over tiktok.com).
export function matchSupplier<T extends SupplierDomains>(hostname: string, suppliers: T[]): T | null {
  const host = hostname.toLowerCase().replace(/\.$/, "");
  let best: { supplier: T; length: number } | null = null;
  for (const supplier of suppliers) {
    for (const domain of supplier.domains) {
      const clean = domain.toLowerCase().trim();
      if (!clean) continue;
      if ((host === clean || host.endsWith(`.${clean}`)) && (!best || clean.length > best.length)) best = { supplier, length: clean.length };
    }
  }
  return best?.supplier ?? null;
}

// Hostnames typed by the admin: lower case, no scheme or path, valid labels only.
export function cleanDomains(values: string[]) {
  const domains = values.map((value) => value.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, ""))
    .filter((value) => /^(?=.{3,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/.test(value));
  return [...new Set(domains)].slice(0, 20);
}
