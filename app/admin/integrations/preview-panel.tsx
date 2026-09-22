"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { BocpImportPreview } from "@/lib/bocp/preview";

type PreviewResponse = {
  mode: "read-only-preview";
  operationalLaunchDate: string;
  invoiceFrom: string;
  orderFrom: string;
  complete: boolean;
  pages: { orders: number; invoices: number };
  summary: BocpImportPreview;
};

type ImportResult = { inserted: number; alreadyPresent: number; blockedInvoices: number; missingSkuLines: number };

export function PreviewPanel({ importEnabled }: { importEnabled: boolean }) {
  const router = useRouter();
  const [from, setFrom] = useState("2026-09-01");
  const [result, setResult] = useState<PreviewResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [importPending, setImportPending] = useState(false);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const [importError, setImportError] = useState("");

  async function loadPreview(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError("");
    setResult(null);
    try {
      const response = await fetch(`/api/admin/bocp/preview?from=${encodeURIComponent(from)}`, {
        method: "GET",
        cache: "no-store",
      });
      const body: PreviewResponse | { error?: string } = await response.json();
      if (!response.ok || !("summary" in body)) {
        throw new Error("error" in body && body.error ? body.error : "Previzualizarea nu este disponibilă acum.");
      }
      setResult(body);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Previzualizarea nu este disponibilă acum.");
    } finally {
      setLoading(false);
    }
  }

  async function importOrders() {
    if (!importEnabled || importPending) return;
    setImportPending(true);
    setImportResult(null);
    setImportError("");
    try {
      const response = await fetch("/api/admin/bocp/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ from: "2026-10-01" }),
        cache: "no-store",
      });
      const body: ImportResult | { error?: string } = await response.json();
      if (!response.ok || !("inserted" in body)) {
        throw new Error("error" in body && body.error ? body.error : "Importul nu este disponibil acum.");
      }
      setImportResult(body);
      router.refresh();
    } catch (cause) {
      setImportError(cause instanceof Error ? cause.message : "Importul nu este disponibil acum.");
    } finally {
      setImportPending(false);
    }
  }

  return (
    <section className="integration-panel" aria-labelledby="bocp-preview-title">
      <div className="integration-panel-heading">
        <div><p className="eyebrow">BOCP · ORDERS + INVOICES</p><h2 id="bocp-preview-title">Audit import pe SKU</h2><p>Verifică eligibilitatea pentru confirmare temporară după SKU. Nicio comandă nu este creată în BoldHub.</p></div>
        <span className="integration-status">Conectare read-only</span>
      </div>
      <form className="preview-form" onSubmit={loadPreview}>
        <label htmlFor="preview-from">Facturi începând cu</label>
        <input id="preview-from" type="date" min="2026-09-01" value={from} onChange={event => setFrom(event.target.value)} required />
        <button type="submit" className="button button-primary" disabled={loading}>{loading ? "Se verifică…" : "Verifică datele"}</button>
      </form>
      <p className="preview-note">Data de lansare operațională planificată rămâne 1 octombrie 2026. O dată anterioară aici este doar pentru testarea integrării pe SKU.</p>
      {error && <p className="notice error" role="alert">{error}</p>}
      {result && (
        <div className="preview-result" aria-live="polite">
          <div className={result.complete ? "preview-alert success" : "preview-alert warning"}>
            <strong>{result.complete ? "Analiză completă pentru intervalul selectat" : "Analiză parțială: există pagini BOCP nepreluate"}</strong>
            <span>{result.pages.orders} pagini Orders · {result.pages.invoices} pagini Invoices. Rezultatele nu modifică BOCP sau Supabase.</span>
          </div>
          <div className="preview-stat-grid">
            <div><span>Orders citite</span><strong>{result.summary.orderRows}</strong></div>
            <div><span>Facturi citite</span><strong>{result.summary.invoiceRows}</strong></div>
            <div><span>Eligibile cu SKU</span><strong>{result.summary.eligibleInvoices}</strong></div>
            <div><span>Neimportabile în picking</span><strong>{result.summary.blockedInvoices}</strong></div>
          </div>
          <div className="preview-breakdown">
            <div><h3>Pot fi confirmate după SKU</h3><p>Shopify <strong>{result.summary.eligibleShopify}</strong></p><p>Marketplace <strong>{result.summary.eligibleMarketplace}</strong></p><p>Linii cu SKU <strong>{result.summary.scannableLines}</strong></p></div>
            <div><h3>Necesită verificare</h3><p>Produse fără SKU <strong>{result.summary.missingSkuLines}</strong></p><p>Cantități invalide <strong>{result.summary.invalidQuantityLines}</strong></p><p>Linii neclasificate <strong>{result.summary.unknownLines}</strong></p></div>
            <div><h3>Excluse sau ignorate</h3><p>Facturi anulate <strong>{result.summary.cancelledInvoices}</strong></p><p>Fără produse pozitive <strong>{result.summary.noPositiveProductsInvoices}</strong></p><p>Legături fără factură în interval <strong>{result.summary.missingInvoices}</strong></p><p>Servicii / transport / reduceri <strong>{result.summary.serviceLines}</strong></p><p>Linii cu cantitate nepozitivă <strong>{result.summary.nonpositiveQuantityLines}</strong></p></div>
          </div>
          {result.summary.missingSkuProducts.length > 0 && <div className="preview-exceptions">
            <h3>Produse fără SKU — blochează importul</h3>
            <p>Aceste produse fizice nu pot fi confirmate până nu au SKU în BOCP.</p>
            <div className="preview-table-wrap"><table><thead><tr><th>Produs</th><th>ID BOCP</th><th>Linii afectate</th></tr></thead><tbody>
              {result.summary.missingSkuProducts.map(product => <tr key={product.bocpProductId}><td>{product.name || "Produs fără nume"}</td><td>{product.bocpProductId}</td><td>{product.lines}</td></tr>)}
            </tbody></table></div>
          </div>}
          {result.summary.missingEanProducts.length > 0 && <div className="preview-exceptions">
            <h3>EAN-uri pentru etapa finală <span className="preview-optional-count">{result.summary.missingEanLines} linii — nu blochează SKU</span></h3>
            <p>Produsele de mai jos au SKU, dar EAN-ul lipsește sau nu este valid pe facturile analizate. Le vom folosi când activăm scanarea fizică.</p>
            <div className="preview-table-wrap"><table><thead><tr><th>Produs</th><th>Cod produs</th><th>ID BOCP</th><th>Linii afectate</th></tr></thead><tbody>
              {result.summary.missingEanProducts.map(product => <tr key={product.bocpProductId}><td>{product.name || "Produs fără nume"}</td><td>{product.sku || "—"}</td><td>{product.bocpProductId}</td><td>{product.lines}</td></tr>)}
            </tbody></table></div>
            <p className="preview-history-note">Facturile deja emise pot păstra codul de bare vechi. După actualizarea catalogului, verificarea pentru lansare trebuie făcută și pe facturi noi.</p>
          </div>}
          <p className="preview-note">O factură este eligibilă acum doar dacă fiecare produs fizic cu cantitate pozitivă are SKU. EAN-ul este monitorizat separat. Valorile sunt un diagnostic, nu comenzi importate.</p>
        </div>
      )}
      <div className="integration-import">
        <div><p className="eyebrow">IMPORT OPERAȚIONAL</p><h3>Comenzi noi, confirmate după SKU</h3><p>Importă facturile online emise din 1 octombrie 2026. Rerularea nu dublează comenzile și nu resetează progresul operatorilor.</p></div>
        <button type="button" className="button button-primary" onClick={importOrders} disabled={!importEnabled || importPending}>{importPending ? "Se importă…" : "Importă comenzile"}</button>
      </div>
      {!importEnabled && <p className="preview-note integration-import-note">Importul real rămâne dezactivat până la 1 octombrie. Auditul de mai sus poate fi folosit acum.</p>}
      {importError && <p className="notice error integration-import-feedback" role="alert">{importError}</p>}
      {importResult && <p className="preview-alert success integration-import-feedback" role="status">{importResult.inserted} comenzi noi · {importResult.alreadyPresent} deja existente · {importResult.blockedInvoices} facturi blocate pentru verificare.</p>}
    </section>
  );
}
