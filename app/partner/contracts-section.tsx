"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { uploadContractFile } from "@/components/contract-file";
import { formatDateTime } from "@/lib/orders";
import { finishSignedContractUpload, startSignedContractUpload } from "./actions";

export type PartnerContract = { id: string; title: string; status: string; supplier_uploaded_at: string; signed_uploaded_at: string | null };

// The client's contracts: download the one signed by Atelier Rebul, sign it, upload it back.
export function ContractsSection({ contracts, canUpload }: { contracts: PartnerContract[]; canUpload: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [feedback, setFeedback] = useState<{ ok: boolean; message: string } | null>(null);

  function upload(contract: PartnerContract, file: File) {
    setFeedback(null);
    start(async () => {
      const ready = await startSignedContractUpload(contract.id);
      if (!ready.ok) { setFeedback({ ok: false, message: ready.message }); return; }
      const failed = await uploadContractFile(file, ready.path, ready.token);
      if (failed) { setFeedback({ ok: false, message: failed }); return; }
      const result = await finishSignedContractUpload(contract.id, ready.path);
      setFeedback(result);
      if (result.ok) router.refresh();
    });
  }

  return (
    <section className="admin-card partner-list-section">
      <div className="admin-card-heading"><h2>Contracte</h2><p>Descarcă contractul semnat de Atelier Rebul, semnează-l și încarcă-l înapoi aici.</p></div>
      <ul className="par-list partner-lines">{contracts.map((contract) => (
        <li key={contract.id} className="contract-line">
          <span><strong>{contract.title}</strong>
            <small>{contract.status === "both_signed" ? `Semnat de ambele părți · ${formatDateTime(contract.signed_uploaded_at)}` : `Semnat de Atelier Rebul · ${formatDateTime(contract.supplier_uploaded_at)} · așteaptă semnătura ta`}</small></span>
          <span className="line-end contract-actions">
            <a className="text-button" href={`/contracts/${contract.id}/furnizor`} target="_blank" rel="noopener noreferrer">Descarcă</a>
            {contract.status === "both_signed"
              ? <a className="text-button" href={`/contracts/${contract.id}/semnat`} target="_blank" rel="noopener noreferrer">Semnat</a>
              : canUpload && <label className="button button-primary file-button">{pending ? "Se încarcă…" : "Încarcă semnat"}
                <input type="file" accept="application/pdf" disabled={pending} onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ""; if (file) upload(contract, file); }} /></label>}
          </span>
        </li>
      ))}</ul>
      {feedback && <p className={`action-feedback ${feedback.ok ? "success" : "error"}`} role="status" aria-live="polite">{feedback.message}</p>}
    </section>
  );
}
