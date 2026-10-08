/** Fixed, read-only BOCP endpoints. Keep credentials on the server. */

type BocpListEndpoint = "invoices/list" | "proformas/list" | "marketplace/orders/list" | "marketplace/connectors/list" | "product/list" | "product/list/include:images" | "contacts/list/include:address,pricelist";

type BocpListEnvelope = {
  is_error?: boolean | number;
  data?: unknown;
  data_count?: number;
  data_next_page_exists?: number | boolean | string;
  data_next_page?: number | string;
};

export type BocpListPage = {
  rows: unknown[];
  count: number;
  nextPage: number | null;
};

type BocpListOptions = {
  page?: number;
  modifiedAfter?: string;
  dateFrom?: string;
  dateThrough?: string;
  id?: string;
};

function validIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function configuration() {
  const baseUrl = process.env.BOCP_API_BASE_URL;
  const username = process.env.BOCP_API_USERNAME;
  const password = process.env.BOCP_API_PASSWORD;

  if (!baseUrl || !username || !password) {
    throw new Error("BOCP API is not configured.");
  }

  const url = new URL(baseUrl);
  if (
    url.protocol !== "https:" ||
    url.hostname !== "secure.bocp.eu" ||
    url.port ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    !/^\/app\/rest\/v1\/\d+\/$/.test(url.pathname)
  ) {
    throw new Error("BOCP API base URL is invalid.");
  }

  return { url, username, password };
}

export async function bocpGetList(endpoint: BocpListEndpoint, options: BocpListOptions = {}): Promise<BocpListPage> {
  const { url, username, password } = configuration();
  const segments: string[] = endpoint.split("/");

  if (options.dateFrom) {
    if (!validIsoDate(options.dateFrom)) throw new Error("BOCP dateFrom must use a valid YYYY-MM-DD date.");
    segments.push(`datefrom:${options.dateFrom}`);
  }

  if (options.dateThrough) {
    if (!validIsoDate(options.dateThrough)) throw new Error("BOCP dateThrough must use a valid YYYY-MM-DD date.");
    segments.push(`datethrough:${options.dateThrough}`);
  }

  if (options.id !== undefined) {
    if (!/^[1-9][0-9]{0,18}$/.test(options.id)) throw new Error("Invalid BOCP id.");
    segments.push(`id:${options.id}`);
  }

  if (options.modifiedAfter) {
    if (!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(options.modifiedAfter)) {
      throw new Error("BOCP modifiedAfter must use YYYY-MM-DD HH:mm:ss.");
    }
    segments.push(`modifiedafter:${options.modifiedAfter}`);
  }

  if (options.page !== undefined) {
    if (!Number.isSafeInteger(options.page) || options.page < 1) {
      throw new Error("Invalid BOCP page number.");
    }
    segments.push(`page:${options.page}`);
  }

  const response = await fetch(new URL(`${segments.join("/")}/`, url), {
    method: "GET",
    headers: {
      Accept: "application/json",
      Authorization: `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`,
    },
    cache: "no-store",
    redirect: "error",
    signal: AbortSignal.timeout(30_000),
  });

  // BOCP also returns 401 when the source IP is not allowlisted. Never retry automatically.
  if (response.status === 401) throw new Error("BOCP rejected the credentials or source IP (401). Do not retry automatically.");
  if (!response.ok) throw new Error(`BOCP ${endpoint} request failed (${response.status}).`);

  const payload: BocpListEnvelope = await response.json();
  if (payload.is_error || !Array.isArray(payload.data)) {
    throw new Error(`BOCP ${endpoint} response has an unexpected shape.`);
  }

  const hasNextPage = payload.data_next_page_exists === true || payload.data_next_page_exists === 1 || payload.data_next_page_exists === "1";
  const requestedPage = options.page ?? 1;
  const reportedNextPage = Number(payload.data_next_page);
  return {
    rows: payload.data,
    count: typeof payload.data_count === "number" ? payload.data_count : payload.data.length,
    nextPage: hasNextPage ? (Number.isSafeInteger(reportedNextPage) && reportedNextPage > requestedPage ? reportedNextPage : requestedPage + 1) : null,
  };
}

// A message the admin can act on, from an error thrown while calling BOCP.
export function bocpErrorMessage(error: unknown): string {
  const text = error instanceof Error ? error.message : "";
  if (/not configured|base URL is invalid/.test(text)) return "BOCP nu este configurat pe server (lipsesc variabilele BOCP_API_* în Vercel).";
  if (/\(401\)/.test(text)) return "BOCP a refuzat cererea (401): adresa IP a serverului nu este permisă pentru utilizatorul API sau datele de logare sunt greșite.";
  const status = text.match(/request failed \((\d+)\)/)?.[1];
  if (status) return `BOCP a răspuns cu eroarea ${status}.`;
  if (/fetch failed|ECONN|ETIMEDOUT|ENOTFOUND|aborted|timeout/i.test(text)) return "BOCP nu a putut fi contactat de pe server (conexiune refuzată sau expirată).";
  return "Previzualizarea BOCP nu este disponibilă acum.";
}
