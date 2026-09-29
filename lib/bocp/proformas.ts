import "server-only";
import { bocpGetList } from "./client";

// Proformas issued by BOCP (GET only). BOCP issues them itself for the connector's bank-transfer
// orders; its list does not say which order a proforma belongs to, so the app recognises it by
// date, total and the client's name on the document.
export type BocpProforma = { bocpProformaId: string; number: string; date: string; total: number; cancelled: boolean; viewLink: string | null };

const MAX_PAGES = 5;

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : typeof value === "number" ? String(value) : "";
}

function bocpLink(value: unknown): string | null {
  try {
    const url = new URL(text(value));
    return url.protocol === "https:" && url.hostname === "secure.bocp.eu" ? url.toString() : null;
  } catch { return null; }
}

function toProforma(row: Record<string, unknown>): BocpProforma | null {
  const id = text(row.proforma_id);
  if (!/^[1-9][0-9]{0,18}$/.test(id)) return null;
  return {
    bocpProformaId: id,
    number: `${text(row.doc_series)} ${text(row.doc_nr)}`.trim(),
    date: text(row.doc_date).slice(0, 10),
    total: Number(row.total) || 0,
    cancelled: text(row.document_cancelled) === "1",
    viewLink: bocpLink(row.view_link),
  };
}

// Lowercase, no diacritics, entities decoded, tags and extra spaces removed.
function plain(value: string) {
  return value
    .replace(/<[^>]+>/g, " ")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#039;|&apos;/g, "'").replace(/&nbsp;/g, " ")
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .toLowerCase().replace(/\s+/g, " ");
}

async function mentionsClient(viewLink: string | null, clientName: string) {
  if (!viewLink) return false;
  try {
    const response = await fetch(viewLink, { cache: "no-store", redirect: "error", signal: AbortSignal.timeout(20_000) });
    return response.ok && plain(await response.text()).includes(plain(clientName));
  } catch { return false; }
}

// The proforma BOCP issued since `issuedFrom` for this client and total, skipping ones already linked.
export async function findIssuedProforma(match: { issuedFrom: string; total: number; clientName: string; exclude: Set<string> }): Promise<BocpProforma | null> {
  const candidates: BocpProforma[] = [];
  let page: number | null = 1;
  for (let fetched = 0; page !== null && fetched < MAX_PAGES; fetched++) {
    const result = await bocpGetList("proformas/list", { dateFrom: match.issuedFrom, page });
    for (const raw of result.rows) {
      if (!raw || typeof raw !== "object") continue;
      const proforma = toProforma(raw as Record<string, unknown>);
      if (proforma && !proforma.cancelled && !match.exclude.has(proforma.bocpProformaId)
        && proforma.date >= match.issuedFrom && Math.abs(proforma.total - match.total) < 0.1) {
        candidates.push(proforma);
      }
    }
    page = result.nextPage;
  }
  // Newest first: the proforma was just issued.
  candidates.sort((a, b) => Number(b.bocpProformaId) - Number(a.bocpProformaId));
  for (const proforma of candidates.slice(0, 5)) {
    if (await mentionsClient(proforma.viewLink, match.clientName)) return proforma;
  }
  return null;
}

// A fresh PDF link for a proforma (BOCP links expire): the view link, in its PDF form.
export async function proformaPdfUrl(bocpProformaId: string): Promise<string | null> {
  const result = await bocpGetList("proformas/list", { id: bocpProformaId });
  const row = result.rows.find((raw) => raw && typeof raw === "object" && text((raw as Record<string, unknown>).proforma_id) === bocpProformaId);
  const proforma = row ? toProforma(row as Record<string, unknown>) : null;
  if (!proforma?.viewLink) return null;
  return proforma.viewLink.replace(/\/html\/?$/, "/pdf/");
}
