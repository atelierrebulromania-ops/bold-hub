"use server";

import { redirect } from "next/navigation";
import { loginIdentifier } from "@/lib/accounts";
import { createClient } from "@/lib/supabase/server";

export async function signIn(formData: FormData) {
  const username = String(formData.get("username") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  if (!username || !password) redirect("/login?error=missing");

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email: loginIdentifier(username), password });
  if (error) redirect("/login?error=invalid");
  redirect("/");
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}
