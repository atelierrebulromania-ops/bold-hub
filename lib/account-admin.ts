import "server-only";
import { loginEmail, minPasswordLength, normalizeUsername, usernamePattern } from "@/lib/accounts";
import { createAdminClient } from "@/lib/supabase/admin";

// Login-account operations for admin server actions. Callers must check the admin role first.
export type AccountError = "no_service_key" | "username_invalid" | "password_short" | "username_taken" | "failed";

export const accountErrorMessages: Record<AccountError, string> = {
  no_service_key: "Lipsește cheia SUPABASE_SERVICE_ROLE_KEY pe server, așa că nu pot gestiona conturi.",
  username_invalid: "Username-ul are 3–32 caractere: litere mici, cifre, punct, cratimă sau underscore.",
  password_short: `Parola trebuie să aibă cel puțin ${minPasswordLength} caractere.`,
  username_taken: "Există deja un cont cu acest username.",
  failed: "Nu am putut salva contul. Încearcă din nou.",
};

// A password set by someone else (admin or agent) is temporary: the user must choose their own at the next sign-in.
// Kept in the login's app_metadata, which only the server can change, so it reaches the session token.
export const passwordChangeFlag = "password_change_required";

export function adminAuth() {
  return createAdminClient();
}

export async function createLogin(rawUsername: string, password: string): Promise<{ id: string; username: string } | { error: AccountError }> {
  const admin = createAdminClient();
  if (!admin) return { error: "no_service_key" };
  const username = normalizeUsername(rawUsername);
  if (!usernamePattern.test(username)) return { error: "username_invalid" };
  if (password.length < minPasswordLength) return { error: "password_short" };
  const { data, error } = await admin.auth.admin.createUser({ email: loginEmail(username), password, email_confirm: true, app_metadata: { [passwordChangeFlag]: true } });
  if (error || !data.user) return { error: error?.code === "email_exists" || error?.status === 422 ? "username_taken" : "failed" };
  return { id: data.user.id, username };
}

export async function setLoginPassword(id: string, password: string): Promise<AccountError | null> {
  const admin = createAdminClient();
  if (!admin) return "no_service_key";
  if (password.length < minPasswordLength) return "password_short";
  const { error } = await admin.auth.admin.updateUserById(id, { password, app_metadata: { [passwordChangeFlag]: true } });
  return error ? "failed" : null;
}

// A deactivated account keeps its history but can no longer sign in.
export async function setLoginBlocked(id: string, blocked: boolean): Promise<AccountError | null> {
  const admin = createAdminClient();
  if (!admin) return "no_service_key";
  const { error } = await admin.auth.admin.updateUserById(id, { ban_duration: blocked ? "876000h" : "none" });
  return error ? "failed" : null;
}

export async function deleteLogin(id: string): Promise<AccountError | null> {
  const admin = createAdminClient();
  if (!admin) return "no_service_key";
  const { error } = await admin.auth.admin.deleteUser(id);
  return error ? "failed" : null;
}

// The user chose their own password: the temporary-password mark goes away.
export async function clearPasswordChange(id: string): Promise<AccountError | null> {
  const admin = createAdminClient();
  if (!admin) return "no_service_key";
  const { error } = await admin.auth.admin.updateUserById(id, { app_metadata: { [passwordChangeFlag]: false } });
  return error ? "failed" : null;
}

// Whether a login is paused (deactivated): it exists but cannot sign in.
export async function isLoginBlocked(id: string | null): Promise<boolean> {
  if (!id) return false;
  const admin = createAdminClient();
  if (!admin) return false;
  const { data } = await admin.auth.admin.getUserById(id);
  const until = (data.user as { banned_until?: string | null } | null)?.banned_until;
  return !!until && Date.parse(until) > Date.now();
}
