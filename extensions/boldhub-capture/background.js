// Receives the token from the BoldHub connect page (only BoldHub origins can message the extension, see
// externally_connectable in manifest.json) and keeps it in the extension's local storage.
const allowedOrigins = ["https://www.boldhub.ro", "http://localhost:3001"];

chrome.runtime.onMessageExternal.addListener((message, sender, sendResponse) => {
  const origin = sender.origin ?? (sender.url ? new URL(sender.url).origin : "");
  if (!allowedOrigins.includes(origin) || message?.type !== "boldhub-capture:connect") { sendResponse({ ok: false }); return; }
  if (typeof message.token !== "string" || !/^bhc_[A-Za-z0-9_-]{43}$/.test(message.token) || message.apiBase !== origin) { sendResponse({ ok: false }); return; }
  chrome.storage.local.set({ token: message.token, apiBase: origin, expiresAt: message.expiresAt ?? null }).then(() => sendResponse({ ok: true }));
  return true;
});
