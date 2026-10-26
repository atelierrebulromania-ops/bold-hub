"use client";

import { createClient } from "@/lib/supabase/client";

// Uploads a contract PDF straight to storage with the one-time signed URL made by the server.
export async function uploadContractFile(file: File, path: string, token: string): Promise<string | null> {
  if (file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")) return "Alege un fișier PDF.";
  if (file.size > 20 * 1024 * 1024) return "Fișierul are peste 20 MB.";
  const { error } = await createClient().storage.from("partner-contracts").uploadToSignedUrl(path, token, file, { contentType: "application/pdf" });
  return error ? "Încărcarea nu a reușit. Verifică conexiunea și încearcă din nou." : null;
}
