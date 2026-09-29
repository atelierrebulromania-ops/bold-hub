import "server-only";

/**
 * The BOCP order connector "hub.atelierrebul.ro" (type BOCP REST API). It is the only place the app
 * writes to BOCP: it creates (POST) or updates (PUT) the order behind a B2B cart or a proforma. BOCP
 * reserves the stock when such an order is imported and issues a proforma for bank-transfer orders;
 * invoicing stays manual in BOCP.
 */

export type ConnectorAddress = { street: string; city: string; county: string; zip: string; country: string };

export type ConnectorOrder = {
  orderId: string;
  date: string;
  mentions: string;
  client: { name: string; isCompany: boolean; vatId: string; registrationNumber: string; phone: string; email: string; address: ConnectorAddress };
  items: { code: string; name: string; quantity: number; price: number; priceWithVat: number; vatPercent: number }[];
  // The connector issues a proforma only for bank_transfer orders; plain reservations go as credit.
  withProforma?: boolean;
  // Cancelling the order releases its stock; a proforma issued for it stays (billing cancels it).
  cancelled?: boolean;
};

export type ConnectorResult = { ok: true; bocpOrderId: string } | { ok: false; error: string };

function configuration() {
  const baseUrl = process.env.BOCP_API_BASE_URL;
  const id = process.env.BOCP_B2B_CONNECTOR_ID;
  const username = process.env.BOCP_B2B_CONNECTOR_USERNAME;
  const password = process.env.BOCP_B2B_CONNECTOR_PASSWORD;
  if (!baseUrl || !id || !/^\d+$/.test(id) || !username || !password) return null;
  const url = new URL(baseUrl);
  if (url.protocol !== "https:" || url.hostname !== "secure.bocp.eu") return null;
  return { url, id, auth: `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}` };
}

export function connectorReady() {
  return configuration() !== null;
}

const money = (value: number) => Math.round(value * 100) / 100;

function payload(order: ConnectorOrder) {
  const address = {
    city: order.client.address.city, county: order.client.address.county, country: order.client.address.country,
    zip: order.client.address.zip, street: order.client.address.street, number: "", building: "", stair: "", floor: "", apartment: "", GLN: "",
  };
  return {
    order_unique_id: order.orderId,
    order_reference: order.orderId,
    order_date: order.date,
    order_updated_at: `${order.date} ${new Date().toLocaleTimeString("en-GB", { timeZone: "Europe/Bucharest", hour12: false })}`,
    order_status: order.cancelled ? "cancelled" : "new",
    order_cancelled: order.cancelled ? 1 : 0,
    order_mentions: order.mentions,
    order_currency_code: "RON",
    // Delivered by the partner flow, not by courier: no AWB is generated.
    shipping_method: "personal_pickup",
    cod_amount: 0,
    cod_currency: "RON",
    client: {
      name: order.client.name,
      representative: order.client.name,
      email: order.client.email,
      phone: order.client.phone,
      vat_id: order.client.isCompany ? order.client.vatId : "",
      registration_number: order.client.isCompany ? order.client.registrationNumber : "",
      invoice_address: address,
      delivery_address: { ...address, shipping_contact_name: order.client.name, shipping_contact_phone: order.client.phone },
    },
    // List prices: billing applies the partner's discount when it issues the invoice.
    items: order.items.map((item) => ({
      type: "product", code: item.code, item_name: item.name, item_quantity: item.quantity,
      item_price: money(item.price), item_vat_percent: item.vatPercent, item_price_with_vat: money(item.priceWithVat),
      line_value_with_vat: money(item.priceWithVat * item.quantity),
    })),
    payment_method: order.withProforma ? "bank_transfer" : "credit",
    payments: [],
  };
}

type Envelope = { is_error?: boolean | number; messages?: unknown; data?: { BOCP_order_id?: unknown; errors?: unknown } };

function errorText(json: Envelope | null, status: number) {
  const parts = [json?.data?.errors, json?.messages].flatMap((value) => Array.isArray(value) ? value : value ? [value] : []);
  const text = parts.map((part) => typeof part === "string" ? part : JSON.stringify(part)).join("; ").slice(0, 400);
  return text || `BOCP a răspuns cu ${status}.`;
}

async function send(method: "POST" | "PUT", orderId: string, body: unknown): Promise<{ status: number; json: Envelope | null }> {
  const config = configuration();
  if (!config) throw new Error("not_configured");
  const response = await fetch(new URL(`connector/${config.id}/order/${encodeURIComponent(orderId)}/`, config.url), {
    method,
    headers: { Accept: "application/json", "Content-Type": "application/json", Authorization: config.auth },
    body: JSON.stringify(body),
    cache: "no-store",
    redirect: "error",
    signal: AbortSignal.timeout(30_000),
  });
  const json = await response.json().catch(() => null) as Envelope | null;
  return { status: response.status, json };
}

// Creates the order; if BOCP already has it (a retry after a lost answer), sends it as an update.
export async function sendConnectorOrder(order: ConnectorOrder): Promise<ConnectorResult> {
  if (!configuration()) return { ok: false, error: "Conectorul BOCP nu este configurat pe server." };
  const body = payload(order);
  try {
    let result = await send("POST", order.orderId, body);
    if (!(result.status === 200 && !result.json?.is_error) && /exist/i.test(errorText(result.json, result.status))) {
      result = await send("PUT", order.orderId, body);
    }
    const id = result.json?.data?.BOCP_order_id;
    if (result.status === 200 && !result.json?.is_error && (typeof id === "number" || typeof id === "string") && /^[1-9]\d*$/.test(String(id))) {
      return { ok: true, bocpOrderId: String(id) };
    }
    return { ok: false, error: errorText(result.json, result.status) };
  } catch {
    return { ok: false, error: "BOCP nu a răspuns. Încearcă din nou (funcționează doar de pe rețeaua permisă în BOCP)." };
  }
}

// Updates an existing order (PUT), e.g. to cancel it.
export async function updateConnectorOrder(order: ConnectorOrder): Promise<ConnectorResult> {
  if (!configuration()) return { ok: false, error: "Conectorul BOCP nu este configurat pe server." };
  try {
    const result = await send("PUT", order.orderId, payload(order));
    const id = result.json?.data?.BOCP_order_id;
    if (result.status === 200 && !result.json?.is_error && (typeof id === "number" || typeof id === "string") && /^[1-9]\d*$/.test(String(id))) {
      return { ok: true, bocpOrderId: String(id) };
    }
    return { ok: false, error: errorText(result.json, result.status) };
  } catch {
    return { ok: false, error: "BOCP nu a răspuns. Încearcă din nou (funcționează doar de pe rețeaua permisă în BOCP)." };
  }
}
