"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { duplicateVoucher, setArchived, syncWallet, testSaveLink, testWalletConnection } from "./actions";
import { CopyButton } from "./copy-button";

// Buttons that call the voucher actions and show the outcome next to them.

function useRun() {
  const [busy, setBusy] = useState("");
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  async function run<T>(name: string, action: () => Promise<{ ok: true; value: T; warning?: string } | { ok: false; error: string }>, done?: (value: T) => void) {
    setBusy(name);
    setNote(null);
    try {
      const result = await action();
      if (result.ok) done?.(result.value);
      else setNote({ ok: false, text: result.error });
    } catch {
      setNote({ ok: false, text: "Something went wrong. Check your connection and try again." });
    }
    setBusy("");
  }
  return { busy, note, setNote, run };
}

const spin = (on: boolean) => on ? <span className="busy-spinner" aria-hidden="true" /> : null;

export function RowActions({ id, name, archived, compact = false }: { id: string; name: string; archived: boolean; compact?: boolean }) {
  const router = useRouter();
  const { busy, note, run } = useRun();
  return (
    <div className="hc-row-actions">
      {compact && <Link className="button button-outline" href={`/vouchers/${id}`}>View</Link>}
      {!archived && <Link className="button button-outline" href={`/vouchers/${id}/edit`}>Edit</Link>}
      <button type="button" className="button button-outline" disabled={Boolean(busy)}
        onClick={() => window.confirm(`Make a draft copy of “${name}”?`) && run("duplicate", () => duplicateVoucher(id), value => router.push(`/vouchers/${value.id}/edit`))}>
        {spin(busy === "duplicate")}Duplicate</button>
      <button type="button" className={`button ${archived ? "button-outline" : "danger-outline"}`} disabled={Boolean(busy)}
        onClick={() => window.confirm(archived ? `Restore “${name}”?` : `Archive “${name}”? The public API stops serving it (passes already saved stay in the wallets until they expire).`)
          && run("archive", () => setArchived(id, !archived), () => router.refresh())}>
        {spin(busy === "archive")}{archived ? "Restore" : "Archive"}</button>
      {note && <span className="hc-field-error" role="alert">{note.text}</span>}
    </div>
  );
}

export function WalletActions({ id, enabled }: { id: string; enabled: boolean }) {
  const router = useRouter();
  const { busy, note, setNote, run } = useRun();
  const [test, setTest] = useState<{ saveUrl: string; qrSvg: string } | null>(null);
  return (
    <div className="dv-wallet-actions">
      <div className="hc-row-actions dv-left">
        <button type="button" className="button button-primary" disabled={!enabled || Boolean(busy)}
          onClick={() => run("sync", () => syncWallet(id), ids => { setNote({ ok: true, text: `Synced: class ${ids.classId}, object ${ids.objectId}.` }); router.refresh(); })}>
          {spin(busy === "sync")}Sync now</button>
        <button type="button" className="button button-outline" disabled={!enabled || Boolean(busy)}
          onClick={() => run("test", () => testSaveLink(id), value => { setTest(value); router.refresh(); })}>
          {spin(busy === "test")}Test Add to Google Wallet</button>
      </div>
      {!enabled && <p className="dv-note">Google Wallet is turned off for this voucher (Edit → Distribution).</p>}
      {note && <p className={note.ok ? "dv-ok" : "hc-field-error"} role="status">{note.text}</p>}
      {test && <div className="dv-test-link">
        <span className="dv-test-qr" dangerouslySetInnerHTML={{ __html: test.qrSvg }} />
        <div>
          <p><strong>Test link ready.</strong> Scan the QR with an Android phone, or open the link on a phone signed in to Google, then tap Save. Test opens are not counted in the statistics.</p>
          <div className="hc-row-actions dv-left">
            <a className="button button-outline" href={test.saveUrl} target="_blank" rel="noreferrer">Open the save link</a>
            <CopyButton value={test.saveUrl} label="Copy link" />
          </div>
        </div>
      </div>}
    </div>
  );
}

export function ConnectionTest() {
  const { busy, note, setNote, run } = useRun();
  return (
    <div className="dv-wallet-actions">
      <div className="hc-row-actions dv-left">
        <button type="button" className="button button-primary" disabled={Boolean(busy)}
          onClick={() => run("test", () => testWalletConnection(), value => setNote({ ok: true, text: value.message }))}>
          {spin(busy === "test")}Test connection</button>
      </div>
      {note && <p className={note.ok ? "dv-ok" : "hc-field-error"} role="status">{note.text}</p>}
    </div>
  );
}
