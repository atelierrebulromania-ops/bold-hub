"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { loginIdentifier } from "@/lib/accounts";
import { createClient } from "@/lib/supabase/server";
import { rememberCookie } from "@/lib/supabase/remember";

export async function signIn(formData: FormData) {
  const username = String(formData.get("username") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const remember = formData.get("remember") === "on";
  if (!username || !password) redirect("/login?error=missing");

  // Not remembered: a browser-session marker, so this session's cookies never get an expiry date.
  const cookieStore = await cookies();
  if (remember) cookieStore.delete(rememberCookie);
  else cookieStore.set(rememberCookie, "0", { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/" });

  const supabase = await createClient(remember);
  const { error } = await supabase.auth.signInWithPassword({ email: loginIdentifier(username), password });
  if (error) redirect("/login?error=invalid");
  redirect("/");
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  (await cookies()).delete(rememberCookie);
  redirect("/login");
}
