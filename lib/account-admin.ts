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

export function adminAuth() {
  return createAdminClient();
}

export async function createLogin(rawUsername: string, password: string): Promise<{ id: string; username: string } | { error: AccountError }> {
  const admin = createAdminClient();
  if (!admin) return { error: "no_service_key" };
  const username = normalizeUsername(rawUsername);
  if (!usernamePattern.test(username)) return { error: "username_invalid" };
  if (password.length < minPasswordLength) return { error: "password_short" };
  const { data, error } = await admin.auth.admin.createUser({ email: loginEmail(username), password, email_confirm: true });
  if (error || !data.user) return { error: error?.code === "email_exists" || error?.status === 422 ? "username_taken" : "failed" };
  return { id: data.user.id, username };
}

export async function setLoginPassword(id: string, password: string): Promise<AccountError | null> {
  const admin = createAdminClient();
  if (!admin) return "no_service_key";
  if (password.length < minPasswordLength) return "password_short";
  const { error } = await admin.auth.admin.updateUserById(id, { password });
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
