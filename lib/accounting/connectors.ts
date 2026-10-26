import "server-only";
import type { DocType } from "./files";

// Stage 3 groundwork: automatic sources (platform APIs, email import) plug in here. None is implemented yet, so
// every integration stays "available" (extension) or "not configured" until a connector really runs.
//
// A connector only finds documents and downloads their bytes. Filing goes through the same path as manual and
// Capture uploads (lib/accounting/store.ts → finishUpload): byte checks, SHA-256, de-duplication by external id
// and invoice number, 30-day retention. Credentials live in Supabase Vault, never in this table or the client.

export type FoundDocument = {
  externalId: string;            // the platform's own id, used for de-duplication
  fileName: string;
  docType: DocType;
  invoiceNumber: string | null;  // only when the platform returns it; never guessed
  issuedOn: string | null;       // YYYY-MM-DD, only when the platform returns it
  period: string | null;         // YYYY-MM
  download: () => Promise<Uint8Array>;
};

export type SyncContext = {
  companyId: string;
  since: Date;                   // documents issued after this date
  secret: (name: string) => Promise<string | null>; // reads a credential from Vault
};

export type Connector = {
  supplierSlug: string;          // accounting_suppliers.slug
  method: "api" | "email";
  // True when the credentials work; the integration is shown "connected" only after this succeeds.
  check: (context: SyncContext) => Promise<{ ok: true } | { ok: false; error: string }>;
  list: (context: SyncContext) => AsyncIterable<FoundDocument>;
};

// Planned: shopify_payments_fees, shopify_payouts (Shopify Admin API), then email import per supplier.
export const connectors: Connector[] = [];

export function connectorFor(slug: string) {
  return connectors.find((connector) => connector.supplierSlug === slug) ?? null;
}
