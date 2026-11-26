import { notFound, redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { requireRole } from "@/lib/auth";
import { publicAssetUrl } from "@/lib/vouchers/google-wallet";
import { appleWalletStatus, loadVoucher, voucherRoles } from "@/lib/vouchers/server";
import { VoucherForm } from "../../form";

export const dynamic = "force-dynamic";

export default async function EditVoucherPage({ params }: { params: Promise<{ id: string }> }) {
  const { supabase, profile } = await requireRole(voucherRoles);
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const voucher = await loadVoucher(supabase, id);
  if (!voucher) notFound();
  if (voucher.archived_at) redirect(`/vouchers/${id}`);
  return (
    <AppShell profile={profile} active="/vouchers/list" section="Digital Vouchers" title={`Edit · ${voucher.name}`}
      note={{ title: "Voucher form", text: "General, Design and Distribution. The preview on the right shows the Google Wallet pass as you type." }}>
      <div className="page-heading"><div><h1>{voucher.name}</h1><p className="muted">Saving updates the Google Wallet pass too, once it has been created there.</p></div></div>
      <VoucherForm voucher={voucher} assetBase={publicAssetUrl("x").replace(/\/x$/, "")} appleConfigured={appleWalletStatus().ready} />
    </AppShell>
  );
}
