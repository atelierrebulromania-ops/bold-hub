"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireRole } from "@/lib/auth";

export async function setAutoImport(form: FormData) {
  const { supabase } = await requireRole(["admin"]);
  const { error } = await supabase.rpc("set_auto_import", { p_on: form.get("on") === "true" });
  revalidatePath("/admin/integrations");
  redirect(error ? "/admin/integrations?error=not_launched" : "/admin/integrations");
}
