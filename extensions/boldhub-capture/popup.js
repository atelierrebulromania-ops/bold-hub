// BoldHub Capture popup: finds the supplier of the open page and the documents on it, then sends the chosen file
// to BoldHub (signed upload straight to private storage, then BoldHub checks, de-duplicates and files it).

const maxBytes = 25 * 1024 * 1024;
const kinds = { pdf: "application/pdf", csv: "text/csv", xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" };
const $ = (id) => document.getElementById(id);

const state = { token: null, apiBase: null, session: null, tab: null, host: "", candidates: [], chosen: null, file: null, busy: false };

function show(view) {
  for (const section of document.querySelectorAll(".view")) section.hidden = section.id !== `view-${view}`;
  $("menu-button").hidden = view === "connect" || view === "loading";
}

function kindOf(name) {
  const extension = (name.split(".").pop() || "").toLowerCase();
  return kinds[extension] ? extension : null;
}

// Same rule as BoldHub (lib/accounting/files.ts): exact domain or a subdomain of it, longest match wins.
function matchSupplier(host, suppliers) {
  const clean = host.toLowerCase().replace(/\.$/, "");
  let best = null;
  for (const supplier of suppliers) {
    for (const domain of supplier.domains) {
      if ((clean === domain || clean.endsWith(`.${domain}`)) && (!best || domain.length > best.length)) best = { supplier, length: domain.length };
    }
  }
  return best?.supplier ?? null;
}

async function api(path, init = {}) {
  const response = await fetch(`${state.apiBase}${path}`, {
    ...init, headers: { ...(init.headers || {}), Authorization: `Bearer ${state.token}`, ...(init.body ? { "Content-Type": "application/json" } : {}) },
  });
  const body = await response.json().catch(() => ({}));
  if (response.status === 401) { await chrome.storage.local.remove(["token"]); throw Object.assign(new Error(body.error || "Extensia nu mai este conectată."), { unpaired: true }); }
  if (!response.ok && response.status !== 422) throw new Error(body.error || "BoldHub nu răspunde. Încearcă din nou.");
  return body;
}

// ---- Pairing ----------------------------------------------------------------------------------------------

$("connect").addEventListener("click", async () => {
  const apiBase = $("server").value;
  await chrome.storage.local.set({ apiBase });
  chrome.tabs.create({ url: `${apiBase}/accounting/capture/connect?ext=${chrome.runtime.id}` });
  window.close();
});

$("save-token").addEventListener("click", async () => {
  const token = $("manual-token").value.trim();
  if (!/^bhc_[A-Za-z0-9_-]{43}$/.test(token)) { showConnectError("Cheia nu are formatul corect (începe cu bhc_)."); return; }
  await chrome.storage.local.set({ token, apiBase: $("server").value });
  start();
});

function showConnectError(text) {
  $("connect-error").textContent = text;
  $("connect-error").hidden = false;
}

// ---- Page detection ---------------------------------------------------------------------------------------

// Runs inside the open page (activeTab): documents linked or embedded on it.
function collectDocuments() {
  const found = new Map();
  const add = (url, label) => {
    try {
      const absolute = new URL(url, location.href);
      if (!/^https?:$/.test(absolute.protocol)) return;
      const key = absolute.href;
      if (!found.has(key)) found.set(key, (label || "").replace(/\s+/g, " ").trim().slice(0, 90));
    } catch { /* not a URL */ }
  };
  const looksLikeDocument = (href, text) => /\.(pdf|csv|xlsx)(\?|#|$)/i.test(href) || /(invoice|factur|receipt|chitan|statement|payout).*(pdf|download|descarc)|(pdf|download|descarc).*(invoice|factur|receipt)/i.test(`${href} ${text}`);
  for (const link of document.querySelectorAll("a[href]")) {
    const text = link.textContent || link.getAttribute("aria-label") || link.title || "";
    if (looksLikeDocument(link.href, text) || link.hasAttribute("download")) add(link.href, text || link.getAttribute("download"));
  }
  for (const frame of document.querySelectorAll("embed[src], iframe[src], object[data]")) {
    const src = frame.getAttribute("src") || frame.getAttribute("data");
    const type = (frame.getAttribute("type") || "").toLowerCase();
    if (type.includes("pdf") || /\.pdf(\?|#|$)/i.test(src)) add(src, "Document afișat în pagină");
  }
  return [...found.entries()].slice(0, 25).map(([url, label]) => ({ url, label }));
}

// Runs inside the open page: downloads one document with the page's own session (same-origin requests).
async function fetchInPage(url) {
  try {
    const response = await fetch(url, { credentials: "include" });
    if (!response.ok) return { error: `HTTP ${response.status}` };
    const blob = await response.blob();
    if (blob.size > 25 * 1024 * 1024) return { error: "too-big" };
    const disposition = response.headers.get("content-disposition") || "";
    const buffer = new Uint8Array(await blob.arrayBuffer());
    let binary = "";
    for (let index = 0; index < buffer.length; index += 0x8000) binary += String.fromCharCode(...buffer.subarray(index, index + 0x8000));
    return { base64: btoa(binary), type: blob.type, disposition, finalUrl: response.url };
  } catch (error) {
    return { error: String(error?.message || error) };
  }
}

function nameFrom(url, disposition, type) {
  const fromHeader = /filename\*=UTF-8''([^;]+)|filename="?([^";]+)"?/i.exec(disposition || "");
  let name = fromHeader ? decodeURIComponent(fromHeader[1] || fromHeader[2]) : "";
  if (!name) { try { name = decodeURIComponent(new URL(url).pathname.split("/").pop() || ""); } catch { name = ""; } }
  name = name.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, "").trim();
  if (!kindOf(name)) {
    const extension = type?.includes("pdf") ? "pdf" : type?.includes("csv") ? "csv" : type?.includes("spreadsheetml") ? "xlsx" : "pdf";
    name = `${name.replace(/\.[a-z0-9]{1,5}$/i, "") || "document"}.${extension}`;
  }
  return name.slice(0, 180);
}

async function detectPage() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  state.tab = tab;
  let url = null;
  try { url = tab?.url ? new URL(tab.url) : null; } catch { url = null; }
  state.host = url && /^https?:$/.test(url.protocol) ? url.hostname : "";
  const supplier = state.host ? matchSupplier(state.host, state.session.suppliers) : null;
  $("source-host").textContent = state.host || "Pagina curentă nu este un site";
  $("source-name").textContent = supplier ? supplier.name : "Furnizor nerecunoscut — alege-l mai jos";
  $("source-dot").classList.toggle("found", !!supplier);
  if (supplier) { $("supplier").value = supplier.id; $("doc-type").value = supplier.default_doc_type; }

  const candidates = [];
  if (state.host) {
    // The tab itself is a document (Chrome's PDF viewer keeps the file's URL).
    if (/\.(pdf|csv|xlsx)(\?|#|$)/i.test(url.pathname) || tab.title?.toLowerCase().endsWith(".pdf")) candidates.push({ url: tab.url, label: tab.title || "Documentul deschis", self: true });
    try {
      const [result] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: collectDocuments });
      for (const item of result?.result ?? []) if (!candidates.some((candidate) => candidate.url === item.url)) candidates.push(item);
    } catch { /* PDF viewer or a protected page: nothing to read in it */ }
  }
  state.candidates = candidates;
  renderCandidates();
}

function renderCandidates() {
  const list = $("candidates");
  list.replaceChildren();
  if (!state.candidates.length) {
    const note = document.createElement("p");
    note.className = "empty-note";
    note.textContent = "Nu am găsit facturi în pagină. Deschide factura (PDF) sau descarc-o și alege fișierul.";
    list.append(note);
    return;
  }
  state.candidates.forEach((candidate, index) => {
    const row = document.createElement("label");
    row.className = `candidate${state.chosen === index ? " active" : ""}`;
    const input = Object.assign(document.createElement("input"), { type: "radio", name: "candidate", checked: state.chosen === index });
    input.addEventListener("change", () => { state.chosen = index; state.file = null; $("file").value = ""; refresh(); });
    const label = document.createElement("span");
    label.textContent = candidate.label || nameFrom(candidate.url, "", "");
    label.title = candidate.url;
    const tag = document.createElement("small");
    tag.textContent = candidate.self ? "fila curentă" : (kindOf(new URL(candidate.url).pathname) || "link").toUpperCase();
    row.append(input, label, tag);
    list.append(row);
  });
}

$("file").addEventListener("change", () => {
  const file = $("file").files?.[0] ?? null;
  state.file = file;
  if (file) state.chosen = null;
  refresh();
});

function refresh() {
  renderCandidates();
  $("file-label").textContent = state.file ? state.file.name : "Alege un fișier de pe calculator (PDF, CSV, XLSX)";
  $("file").closest(".file-pick").classList.toggle("active", !!state.file);
  $("send").disabled = state.busy || (!state.file && state.chosen === null) || !$("company").value || !$("supplier").value;
}
for (const id of ["company", "supplier"]) $(id).addEventListener("change", refresh);
$("supplier").addEventListener("change", () => {
  const supplier = state.session.suppliers.find((item) => item.id === $("supplier").value);
  if (supplier) $("doc-type").value = supplier.default_doc_type;
});
$("company").addEventListener("change", () => chrome.storage.local.set({ companyId: $("company").value }));

// ---- Sending ----------------------------------------------------------------------------------------------

async function chosenFile() {
  if (state.file) return state.file;
  const candidate = state.candidates[state.chosen];
  let result = null;
  // First in the page (its session and cookies), then from the extension for the tab's own site (activeTab).
  try {
    const [injected] = await chrome.scripting.executeScript({ target: { tabId: state.tab.id }, func: fetchInPage, args: [candidate.url] });
    result = injected?.result ?? null;
  } catch { result = null; }
  if (!result?.base64 && result?.error !== "too-big") {
    try {
      const response = await fetch(candidate.url, { credentials: "include" });
      if (response.ok) {
        const blob = await response.blob();
        return new File([blob], nameFrom(response.url, response.headers.get("content-disposition"), blob.type), { type: blob.type });
      }
    } catch { /* blocked by the site */ }
  }
  if (result?.error === "too-big") throw new Error("Documentul are peste 25 MB.");
  if (!result?.base64) throw new Error("Site-ul nu permite preluarea automată. Descarcă factura și alege fișierul de pe calculator.");
  const bytes = Uint8Array.from(atob(result.base64), (char) => char.charCodeAt(0));
  return new File([bytes], nameFrom(result.finalUrl || candidate.url, result.disposition, result.type), { type: result.type });
}

async function looksRight(file) {
  const kind = kindOf(file.name);
  if (!kind) return "Sunt acceptate doar PDF, CSV și XLSX.";
  if (file.size === 0) return "Fișierul este gol.";
  if (file.size > maxBytes) return "Fișierul are peste 25 MB.";
  const head = new Uint8Array(await file.slice(0, 1024).arrayBuffer());
  const text = new TextDecoder("latin1").decode(head);
  if (kind === "pdf" && !text.includes("%PDF-")) return "Linkul nu a întors un PDF (poate cere autentificare). Descarcă factura și alege fișierul.";
  if (kind === "xlsx" && !(head[0] === 0x50 && head[1] === 0x4b)) return "Fișierul nu este un XLSX valid.";
  return null;
}

function upload(signedUrl, file, onProgress) {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open("PUT", signedUrl);
    request.setRequestHeader("Content-Type", kinds[kindOf(file.name)]);
    request.setRequestHeader("x-upsert", "false");
    request.upload.onprogress = (event) => event.lengthComputable && onProgress(event.loaded / event.total);
    request.onload = () => request.status >= 200 && request.status < 300 ? resolve() : reject(new Error("Încărcarea fișierului a eșuat."));
    request.onerror = () => reject(new Error("Încărcarea fișierului a eșuat (rețea)."));
    request.send(file);
  });
}

function showResult(kind, text, link) {
  const box = $("result");
  box.className = `message ${kind}`;
  box.replaceChildren(document.createTextNode(text));
  if (link) {
    const anchor = Object.assign(document.createElement("a"), { href: link, textContent: "Deschide în BoldHub →", target: "_blank", rel: "noopener" });
    box.append(document.createElement("br"), anchor);
  }
  box.hidden = false;
}

function setProgress(value) {
  $("progress").hidden = value === null;
  $("progress-bar").style.width = `${Math.round((value ?? 0) * 100)}%`;
}

$("send").addEventListener("click", async () => {
  state.busy = true;
  refresh();
  $("result").hidden = true;
  $("send").textContent = "Se pregătește…";
  setProgress(0.05);
  try {
    const file = await chosenFile();
    const problem = await looksRight(file);
    if (problem) throw new Error(problem);
    $("send").textContent = "Se încarcă…";
    const ticket = await api("/api/capture/uploads", { method: "POST", body: JSON.stringify({ fileName: file.name, size: file.size }) });
    await upload(ticket.signedUrl, file, (part) => setProgress(0.1 + part * 0.8));
    $("send").textContent = "Se verifică…";
    const result = await api("/api/capture/documents", { method: "POST", body: JSON.stringify({
      path: ticket.path, fileName: file.name, companyId: $("company").value, supplierId: $("supplier").value, docType: $("doc-type").value,
      period: $("period").value || null, invoiceNumber: $("invoice-number").value.trim() || null, issuedOn: $("issued-on").value || null,
    }) });
    setProgress(1);
    if (result.status === "created") showResult("ok", `Salvat: ${file.name}`, result.documentUrl);
    else if (result.status === "duplicate") showResult("duplicate", result.message || "Documentul există deja în BoldHub.", result.documentUrl);
    else showResult("error", result.message || "BoldHub a respins fișierul.");
  } catch (error) {
    if (error.unpaired) { start(); return; }
    showResult("error", error.message || "Ceva nu a mers. Încearcă din nou.");
  } finally {
    state.busy = false;
    $("send").textContent = "Trimite în BoldHub";
    setTimeout(() => setProgress(null), 600);
    refresh();
  }
});

// ---- Menu -------------------------------------------------------------------------------------------------

$("menu-button").addEventListener("click", async () => {
  const { expiresAt } = await chrome.storage.local.get("expiresAt");
  $("menu-info").textContent = `Conectat la ${new URL(state.apiBase).host}${state.session?.user?.name ? ` ca ${state.session.user.name}` : ""}.`
    + (expiresAt ? ` Cheia expiră pe ${new Date(expiresAt).toLocaleDateString("ro-RO")}.` : "");
  show("menu");
});
$("menu-back").addEventListener("click", () => show("capture"));
$("open-boldhub").addEventListener("click", () => chrome.tabs.create({ url: `${state.apiBase}/accounting` }));
$("disconnect").addEventListener("click", async () => {
  // Forgets the key here; revoke it in BoldHub → Contabilitate → Integrări so it stops working everywhere.
  await chrome.storage.local.remove(["token", "expiresAt"]);
  chrome.tabs.create({ url: `${state.apiBase}/accounting/integrations` });
  start();
});

// ---- Start ------------------------------------------------------------------------------------------------

function fillSelect(select, items, placeholder) {
  select.replaceChildren(new Option(placeholder, ""), ...items.map((item) => new Option(item.name, item.id)));
}

async function start() {
  show("loading");
  const stored = await chrome.storage.local.get(["token", "apiBase", "companyId"]);
  state.apiBase = stored.apiBase || "https://www.boldhub.ro";
  state.token = stored.token || null;
  $("server").value = state.apiBase;
  if (!state.token) { show("connect"); return; }
  try {
    state.session = await api("/api/capture/session");
  } catch (error) {
    show("connect");
    showConnectError(error.message);
    return;
  }
  $("who").textContent = `${new URL(state.apiBase).host} · ${state.session.user.name}`;
  fillSelect($("company"), state.session.companies, "Alege compania");
  fillSelect($("supplier"), state.session.suppliers, "Alege furnizorul");
  if (stored.companyId && state.session.companies.some((company) => company.id === stored.companyId)) $("company").value = stored.companyId;
  else if (state.session.companies.length === 1) $("company").value = state.session.companies[0].id;
  show("capture");
  await detectPage();
  refresh();
}

start();
