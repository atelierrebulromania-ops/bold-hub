import { AppShell } from "@/components/app-shell";
import { requireRole } from "@/lib/auth";
import { ConnectCapture } from "./connect-capture";

export const dynamic = "force-dynamic";

// Opened by BoldHub Capture ("Conectează BoldHub"): the signed-in administrator confirms, and the page hands the
// extension a limited token. Opened by hand, it shows the token to paste into the extension.
export default async function ConnectCapturePage({ searchParams }: { searchParams: Promise<{ ext?: string }> }) {
  const { profile } = await requireRole(["admin"]);
  const { ext } = await searchParams;
  const extensionId = ext && /^[a-p]{32}$/.test(ext) ? ext : null;
  return (
    <AppShell profile={profile} active="/accounting/integrations" section="Contabilitate" title="Conectează BoldHub Capture"
      note={{ title: "BoldHub Capture", text: "Extensia primește o cheie limitată la încărcarea documentelor, valabilă 90 de zile." }}>
      <ConnectCapture extensionId={extensionId} canConnect={profile.realRole === "admin"} />
    </AppShell>
  );
}
