/** Fixed, read-only BOCP endpoints. Keep credentials on the server. */

type BocpListEndpoint = "invoices/list" | "marketplace/orders/list" | "marketplace/connectors/list";

type BocpListEnvelope = {
  is_error?: boolean;
  data?: unknown;
  data_count?: number;
  data_next_page_exists?: number | boolean;
  data_next_page?: number;
};

export type BocpListPage = {
  rows: unknown[];
  count: number;
  nextPage: number | null;
};

type BocpListOptions = {
  page?: number;
  modifiedAfter?: string;
};

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
    signal: AbortSignal.timeout(15_000),
  });

  // BOCP also returns 401 when the source IP is not allowlisted. Never retry automatically.
  if (response.status === 401) throw new Error("BOCP rejected the credentials or source IP (401). Do not retry automatically.");
  if (!response.ok) throw new Error(`BOCP ${endpoint} request failed (${response.status}).`);

  const payload: BocpListEnvelope = await response.json();
  if (payload.is_error || !Array.isArray(payload.data)) {
    throw new Error(`BOCP ${endpoint} response has an unexpected shape.`);
  }

  const hasNextPage = payload.data_next_page_exists === true || payload.data_next_page_exists === 1;
  return {
    rows: payload.data,
    count: typeof payload.data_count === "number" ? payload.data_count : payload.data.length,
    nextPage: hasNextPage && Number.isSafeInteger(payload.data_next_page) ? payload.data_next_page! : null,
  };
}
