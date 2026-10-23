import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";

// BoldHub Capture is paired with a BoldHub account: the signed-in administrator authorises the extension on a
// BoldHub page, which hands it a random token. Only the token's SHA-256 is stored; the token works only on the
// Capture endpoints, expires after 90 days and can be revoked from Contabilitate → Integrări.
// The extension never holds a password, a Supabase key or a session cookie.

export const captureTokenDays = 90;
const tokenPattern = /^bhc_[A-Za-z0-9_-]{43}$/;

async function hash(token: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, "0")).join("");
}

export async function createCaptureToken(userId: string, label: string) {
  const admin = createAdminClient();
  if (!admin) return null;
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const token = `bhc_${Buffer.from(bytes).toString("base64url")}`;
  const expiresAt = new Date(Date.now() + captureTokenDays * 86400000);
  const { error } = await admin.from("accounting_capture_tokens").insert({
    user_id: userId, label: label.trim().slice(0, 80) || "Chrome", token_hash: await hash(token), expires_at: expiresAt.toISOString(),
  });
  return error ? null : { token, expiresAt };
}

export type CaptureCaller = { userId: string; tokenId: string; name: string };

// The caller of a Capture endpoint, from "Authorization: Bearer bhc_…": a live token of an active administrator.
export async function captureCaller(request: Request): Promise<CaptureCaller | null> {
  const header = request.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!tokenPattern.test(token)) return null;
  const admin = createAdminClient();
  if (!admin) return null;
  const { data: row } = await admin.from("accounting_capture_tokens").select("id,user_id,expires_at,revoked_at")
    .eq("token_hash", await hash(token)).maybeSingle();
  if (!row || row.revoked_at || Date.parse(row.expires_at) <= Date.now()) return null;
  const { data: user } = await admin.from("app_users").select("full_name,role,active").eq("id", row.user_id).maybeSingle();
  if (!user?.active || user.role !== "admin") return null;
  await admin.from("accounting_capture_tokens").update({ last_used_at: new Date().toISOString() }).eq("id", row.id);
  return { userId: row.user_id, tokenId: row.id, name: user.full_name };
}

// Requests from the extension (chrome-extension://…) are answered with CORS headers; nothing else is exposed.
export function captureHeaders(request: Request) {
  const origin = request.headers.get("origin") ?? "";
  const headers: Record<string, string> = { "Cache-Control": "no-store", Vary: "Origin" };
  if (origin.startsWith("chrome-extension://")) {
    headers["Access-Control-Allow-Origin"] = origin;
    headers["Access-Control-Allow-Headers"] = "Authorization, Content-Type";
    headers["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS";
  }
  return headers;
}
