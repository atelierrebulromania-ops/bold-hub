import { AppShell } from "@/components/app-shell";
import { requireRole } from "@/lib/auth";
import { publicAssetUrl } from "@/lib/vouchers/google-wallet";
import { appleWalletStatus, voucherRoles } from "@/lib/vouchers/server";
import { VoucherForm } from "../form";

export const dynamic = "force-dynamic";

export default async function NewVoucherPage() {
  const { profile } = await requireRole(voucherRoles);
  return (
    <AppShell profile={profile} active="/vouchers/list" section="Digital Vouchers" title="New voucher"
      note={{ title: "Voucher form", text: "General, Design and Distribution. The preview on the right shows the Google Wallet pass as you type." }}>
      <div className="page-heading"><div><h1>New voucher</h1><p className="muted">It starts as a draft unless you tick Published.</p></div></div>
      <VoucherForm voucher={null} assetBase={publicAssetUrl("x").replace(/\/x$/, "")} appleConfigured={appleWalletStatus().ready} />
    </AppShell>
  );
}
