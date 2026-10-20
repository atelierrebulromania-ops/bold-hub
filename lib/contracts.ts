import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";

// Contract PDFs live in the private bucket "partner-contracts" under <client>/<contract>/. The browser uploads
// straight to storage with a one-time signed URL (no size limit of server actions); downloads go through
// short-lived signed URLs made after the app checked access.
export const contractBucket = "partner-contracts";

export type ContractUpload = { ok: true; path: string; token: string } | { ok: false; message: string };

export async function contractUploadUrl(clientId: string, contractId: string, side: "furnizor" | "semnat"): Promise<ContractUpload> {
  const admin = createAdminClient();
  if (!admin) return { ok: false, message: "Lipsește cheia de server pentru fișiere." };
  const path = `${clientId}/${contractId}/${side}-${Date.now()}.pdf`;
  const { data, error } = await admin.storage.from(contractBucket).createSignedUploadUrl(path);
  if (error || !data) return { ok: false, message: "Nu am putut pregăti încărcarea. Încearcă din nou." };
  return { ok: true, path: data.path, token: data.token };
}

export async function contractDownloadUrl(path: string, fileName: string) {
  const admin = createAdminClient();
  if (!admin) return null;
  const { data } = await admin.storage.from(contractBucket).createSignedUrl(path, 300, { download: fileName });
  return data?.signedUrl ?? null;
}

export async function removeContractFiles(paths: string[]) {
  const admin = createAdminClient();
  if (admin && paths.length) await admin.storage.from(contractBucket).remove(paths);
}
