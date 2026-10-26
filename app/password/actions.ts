"use server";

import { redirect } from "next/navigation";
import { clearPasswordChange } from "@/lib/account-admin";
import { minPasswordLength } from "@/lib/accounts";
import { createClient } from "@/lib/supabase/server";

export type PasswordState = { error: string } | null;

// Passwords handed out by the admin at the start; nobody may keep them.
const handedOut = ["123456", "1234567", "12345678", "123456789", "parola", "password", "boldhub"];

export async function changeOwnPassword(_state: PasswordState, formData: FormData): Promise<PasswordState> {
  const password = String(formData.get("password") ?? "");
  const confirm = String(formData.get("confirm") ?? "");
  if (password.length < minPasswordLength) return { error: `Parola trebuie să aibă cel puțin ${minPasswordLength} caractere.` };
  if (password.length > 72) return { error: "Parola poate avea cel mult 72 de caractere." };
  if (password !== confirm) return { error: "Cele două parole nu sunt la fel." };
  if (handedOut.includes(password.toLowerCase())) return { error: "Alege o parolă a ta, nu una simplă ca 123456." };

  const supabase = await createClient();
  const { data: authData } = await supabase.auth.getClaims();
  const userId = authData?.claims?.sub;
  if (!userId) redirect("/login");
  const { error } = await supabase.auth.updateUser({ password });
  if (error) return { error: error.code === "same_password" ? "Parola nouă trebuie să fie diferită de cea veche." : "Nu am putut schimba parola. Încearcă din nou." };
  if (await clearPasswordChange(userId)) return { error: "Parola a fost schimbată, dar nu am putut actualiza contul. Reîncarcă pagina." };
  // A fresh token without the temporary-password mark.
  await supabase.auth.refreshSession();
  redirect("/");
}
