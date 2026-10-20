"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { formatDateTime } from "@/lib/orders";
import { formatMoney } from "@/lib/pricing";
import { settleConsignment } from "./actions";

export type ConsignmentLine = { productId: string; name: string; sku: string; sold: number; delivered: number; onShelf: number; lastCountAt: string | null };
export type ConsignmentClient = { id: string; name: string; commission: number; since: string | null; lines: ConsignmentLine[] };
export type Settlement = { id: string; partnerName: string; periodFrom: string | null; periodTo: string; invoiceNumber: string; invoiceTotal: number | null;
  invoiceNet: number | null; commissionPercent: number; commissionAmount: number | null; pdfUrl: string | null; units: number };

// Billing → Consignație: what each consignment client sold since its last settlement (from its shelf counts and
// the deliveries). Billing issues the invoice in BOCP for these products and closes the period with its number;
// the commission is worked out on the invoice value without VAT.
export function ConsignmentBoard({ clients, settlements, periodTo, canInvoice }: { clients: ConsignmentClient[]; settlements: Settlement[]; periodTo: string; canInvoice: boolean }) {
  const router = useRouter();
  const [numbers, setNumbers] = useState<Record<string, string>>({});
  const [feedback, setFeedback] = useState<Record<string, { ok: boolean; message: string }>>({});
  const [pending, start] = useTransition();

  function settle(client: ConsignmentClient) {
    const number = numbers[client.id] ?? "";
    start(async () => {
      const result = await settleConsignment(client.id, periodTo, number);
      setFeedback({ ...feedback, [client.id]: result });
      if (result.ok) { setNumbers({ ...numbers, [client.id]: "" }); router.refresh(); }
    });
  }

  return (
    <div className="consignment-board">
      {clients.length === 0 ? <p className="admin-empty-note">Niciun client în consignație. Regimul se alege în fișa clientului (Regim comercial).</p>
        : <div className="product-blocks">{clients.map((client) => {
          const sold = client.lines.filter((line) => line.sold > 0);
          const units = sold.reduce((sum, line) => sum + line.sold, 0);
          const lastCount = client.lines.reduce<string | null>((latest, line) => line.lastCountAt && (!latest || line.lastCountAt > latest) ? line.lastCountAt : latest, null);
          return (
            <section key={client.id} className="admin-card product-block consignment-card">
              <div className="admin-card-heading"><h2>{client.name} {units > 0 && <span className="product-block-total">{units} buc. vândute</span>}</h2>
                <p>{client.since ? `De la decontul din ${formatDateTime(client.since)}` : "De la prima livrare"} · comision {client.commission}% · ultima numărătoare: {lastCount ? formatDateTime(lastCount) : "niciuna"}</p></div>
              {sold.length === 0 ? <p className="admin-empty-note">Nimic vândut de la ultimul decont (după numărătorile clientului).</p>
                : <ul className="admin-simple-list dashboard-list">{sold.map((line) => <li key={line.productId}>
                  <span>{line.name}<small>SKU {line.sku} · pe raft acum {line.onShelf}</small></span><strong>{line.sold} buc.</strong>
                </li>)}</ul>}
              {canInvoice && sold.length > 0 && <form className="invoice-confirm consignment-settle" onSubmit={(event) => { event.preventDefault(); settle(client); }}>
                <label htmlFor={`settle-${client.id}`}>Nr. factură BOCP pentru produsele vândute</label>
                <input id={`settle-${client.id}`} value={numbers[client.id] ?? ""} maxLength={60} autoComplete="off" placeholder="ex. B2BREB-596"
                  onChange={(event) => setNumbers({ ...numbers, [client.id]: event.target.value })} />
                <button type="submit" className="button button-primary" disabled={pending || !(numbers[client.id] ?? "").trim()}>Închide decontul</button>
              </form>}
              {feedback[client.id] && <p className={`action-feedback ${feedback[client.id].ok ? "success" : "error"}`} role="status">{feedback[client.id].message}</p>}
            </section>
          );
        })}</div>}

      {settlements.length > 0 && <>
        <h3 className="board-subtitle panel-subtitle">Deconturi închise</h3>
        <div className="handed-table-wrap"><table className="handed-table">
          <thead><tr><th>Perioadă</th><th>Client</th><th>Factură</th><th>Vândute</th><th>Valoare fără TVA</th><th>Cu TVA</th><th>Comision</th><th /></tr></thead>
          <tbody>{settlements.map((row) => <tr key={row.id}>
            <td className="nowrap">{row.periodFrom ? formatDateTime(row.periodFrom) : "început"} – {formatDateTime(row.periodTo)}</td>
            <td className="strong">{row.partnerName}</td>
            <td className="nowrap strong">{row.invoiceNumber}</td>
            <td className="nowrap">{row.units} buc.</td>
            <td className="nowrap">{row.invoiceNet !== null ? `${formatMoney(row.invoiceNet)} lei` : "—"}</td>
            <td className="nowrap">{row.invoiceTotal !== null ? `${formatMoney(row.invoiceTotal)} lei` : "—"}</td>
            <td className="nowrap">{row.commissionAmount !== null ? `${formatMoney(row.commissionAmount)} lei` : "—"}<small>{row.commissionPercent}%</small></td>
            <td className="nowrap">{row.pdfUrl && <a className="text-button" href={row.pdfUrl} target="_blank" rel="noopener noreferrer">PDF</a>}</td>
          </tr>)}</tbody>
        </table></div>
      </>}
    </div>
  );
}
