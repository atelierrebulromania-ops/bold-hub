"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { connectCapture } from "../../actions";

type ChromeRuntime = { sendMessage: (id: string, message: unknown, callback: (response: unknown) => void) => void; lastError?: { message?: string } };

function browserLabel() {
  const agent = navigator.userAgent;
  const platform = /Windows/.test(agent) ? "Windows" : /Mac OS/.test(agent) ? "Mac" : /Linux/.test(agent) ? "Linux" : "";
  return ["Chrome", platform].filter(Boolean).join(" · ");
}

export function ConnectCapture({ extensionId, canConnect }: { extensionId: string | null; canConnect: boolean }) {
  const [label, setLabel] = useState("");
  const [state, setState] = useState<{ kind: "idle" | "sent" | "manual" | "error"; text?: string; token?: string }>({ kind: "idle" });
  const [copied, setCopied] = useState(false);
  const [pending, start] = useTransition();

  function connect() {
    start(async () => {
      const result = await connectCapture(label || browserLabel());
      if (!result.ok) { setState({ kind: "error", text: result.message }); return; }
      const runtime = (window as unknown as { chrome?: { runtime?: ChromeRuntime } }).chrome?.runtime;
      if (!extensionId || !runtime?.sendMessage) { setState({ kind: "manual", token: result.token }); return; }
      // The extension accepts this message only from BoldHub pages (externally_connectable in its manifest).
      runtime.sendMessage(extensionId, { type: "boldhub-capture:connect", token: result.token, apiBase: window.location.origin, expiresAt: result.expiresAt }, (response) => {
        const ok = !runtime.lastError && (response as { ok?: boolean } | undefined)?.ok;
        setState(ok ? { kind: "sent" } : { kind: "manual", token: result.token });
      });
    });
  }

  if (!canConnect) return <p className="notice error">Conectarea extensiei se face din contul tău de administrator, nu în modul „Vezi ca”.</p>;

  return (
    <section className="board-panel connect-card">
      {state.kind === "sent" ? <>
        <h2>Extensia este conectată</h2>
        <p>Poți închide această filă. Deschide pagina de facturare a unui furnizor și apasă iconița BoldHub Capture.</p>
        <Link className="button button-outline" href="/accounting/integrations">Înapoi la Integrări</Link>
      </> : state.kind === "manual" ? <>
        <h2>Copiază cheia în extensie</h2>
        <p>Nu am putut trimite cheia direct extensiei. Copiaz-o și lipește-o în extensie, la „Am deja o cheie”. Cheia apare o singură dată.</p>
        <div className="token-box"><code>{state.token}</code>
          <button type="button" className="button button-outline" onClick={() => { navigator.clipboard.writeText(state.token ?? ""); setCopied(true); }}>{copied ? "Copiat" : "Copiază"}</button></div>
      </> : <>
        <h2>Conectezi BoldHub Capture?</h2>
        <p>Extensia va putea doar să încarce documente contabile în BoldHub, în numele tău, timp de 90 de zile. Nu va avea acces la parole, la alte date din BoldHub sau la conturile furnizorilor.
          Poți deconecta extensia oricând din Contabilitate → Integrări.</p>
        <div className="accounting-form-row connect-row">
          <label className="grow"><span>Nume browser <span className="optional">opțional</span></span><input value={label} maxLength={80} onChange={(event) => setLabel(event.target.value)} placeholder="ex. Chrome birou" /></label>
          <button type="button" className="button button-primary" disabled={pending} onClick={connect}>{pending ? "Se conectează…" : "Conectează"}</button>
        </div>
        {state.kind === "error" && <p className="notice error" role="alert">{state.text}</p>}
      </>}
    </section>
  );
}
