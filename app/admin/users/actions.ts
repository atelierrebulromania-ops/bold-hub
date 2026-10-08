"use server";

import { revalidatePath } from "next/cache";
import { accountErrorMessages, createLogin, deleteLogin, setLoginBlocked, setLoginPassword } from "@/lib/account-admin";
import { requireRole, type UserRole } from "@/lib/auth";

type Result = { ok: boolean; message: string };

const page = "/admin/users";
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const roles: UserRole[] = ["admin", "owner", "operator_depozit", "operator_facturare", "account"];
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function cleanProfile(input: { fullName: string; email: string; role: string }) {
  const fullName = input.fullName.trim();
  const email = input.email.trim();
  if (!fullName || fullName.length > 120) return { error: "Introdu numele (maximum 120 de caractere)." };
  if (email && (email.length > 254 || !emailPattern.test(email))) return { error: "Adresa de email nu este validă." };
  if (!roles.includes(input.role as UserRole)) return { error: "Alege un rol." };
  return { fullName, email: email || null, role: input.role as UserRole };
}

export async function createUser(input: { fullName: string; username: string; password: string; email: string; role: string }): Promise<Result> {
  const { supabase } = await requireRole(["admin"]);
  const profile = cleanProfile(input);
  if ("error" in profile) return { ok: false, message: profile.error! };
  const login = await createLogin(input.username, input.password);
  if ("error" in login) return { ok: false, message: accountErrorMessages[login.error] };
  const { error } = await supabase.from("app_users").insert({
    id: login.id, full_name: profile.fullName, username: login.username, notification_email: profile.email, role: profile.role,
  });
  if (error) {
    // Without a profile the login is useless, so do not leave it behind.
    await deleteLogin(login.id);
    return { ok: false, message: error.code === "23505" ? accountErrorMessages.username_taken : accountErrorMessages.failed };
  }
  revalidatePath(page);
  return { ok: true, message: `Contul „${login.username}” a fost creat.` };
}

export async function updateUser(input: { id: string; fullName: string; email: string; role: string; active: boolean }): Promise<Result> {
  const { supabase, userId } = await requireRole(["admin"]);
  if (!uuid.test(input.id)) return { ok: false, message: "Utilizatorul nu este valid." };
  const profile = cleanProfile(input);
  if ("error" in profile) return { ok: false, message: profile.error! };
  if (input.id === userId && (profile.role !== "admin" || !input.active)) {
    return { ok: false, message: "Nu îți poți scoate singur rolul de administrator sau dezactiva propriul cont." };
  }
  const { data: before } = await supabase.from("app_users").select("active").eq("id", input.id).maybeSingle();
  if (!before) return { ok: false, message: "Utilizatorul nu mai există. Reîncarcă pagina." };
  if (before.active !== input.active) {
    const blocked = await setLoginBlocked(input.id, !input.active);
    if (blocked) return { ok: false, message: accountErrorMessages[blocked] };
  }
  const { error } = await supabase.from("app_users")
    .update({ full_name: profile.fullName, notification_email: profile.email, role: profile.role, active: input.active })
    .eq("id", input.id);
  if (error) return { ok: false, message: accountErrorMessages.failed };
  revalidatePath(page);
  return { ok: true, message: "Modificările au fost salvate." };
}

export async function changePassword(id: string, password: string): Promise<Result> {
  await requireRole(["admin"]);
  if (!uuid.test(id)) return { ok: false, message: "Utilizatorul nu este valid." };
  const error = await setLoginPassword(id, password);
  return error ? { ok: false, message: accountErrorMessages[error] } : { ok: true, message: "Parola a fost schimbată." };
}

const deleteMessages: Record<string, string> = {
  self: "Nu îți poți șterge propriul cont.",
  not_found: "Utilizatorul nu mai există. Reîncarcă pagina.",
  clients: "Agentul are clienți asociați. Mută-i la alt agent înainte să ștergi contul, sau dezactivează-l.",
  history: "Contul apare în istoric (comenzi, retururi, documente), așa că nu poate fi șters. Dezactivează-l în schimb.",
};

// Deletes a staff account: the profile first (refused when it appears in the history), then the login.
export async function deleteUser(id: string): Promise<Result> {
  const { supabase } = await requireRole(["admin"]);
  if (!uuid.test(id)) return { ok: false, message: "Utilizatorul nu este valid." };
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return { ok: false, message: accountErrorMessages.no_service_key };
  const { data, error } = await supabase.rpc("delete_staff_user", { p_id: id });
  if (error) return { ok: false, message: accountErrorMessages.failed };
  if (data !== "deleted") return { ok: false, message: deleteMessages[data ?? ""] ?? accountErrorMessages.failed };
  const loginError = await deleteLogin(id);
  revalidatePath(page);
  return loginError
    ? { ok: false, message: "Profilul a fost șters, dar contul de logare nu. Încearcă din nou sau șterge-l din Supabase → Authentication." }
    : { ok: true, message: "Contul a fost șters." };
}
