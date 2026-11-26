import { benefitLabel, validityLabel, voucherLabels, type Voucher } from "@/lib/vouchers/voucher";

// Live preview of the Google Wallet pass. It shows only what Google renders for an offer: the logo in a
// circle, the issuer (brand), the title, the hero image, the text fields, the QR with the code under it and
// the link. Google picks the text colour itself (white or black, by contrast with the background), so the
// preview does the same; the text and accent colours apply to the downloadable image and the landing page.

export type PreviewVoucher = Pick<Voucher,
  "brand" | "name" | "title" | "subtitle" | "discount_code" | "discount_type" | "discount_value" | "currency" | "starts_at" | "expires_at" |
  "timezone" | "language" | "background_color" | "show_discount_value" | "show_discount_code" | "short_description" | "long_description" | "terms">;

// Same rule as Google: dark backgrounds get white text.
export function walletTextColor(hex: string) {
  const value = /^#[0-9A-Fa-f]{6}$/.test(hex) ? hex : "#000000";
  const [r, g, b] = [1, 3, 5].map(index => parseInt(value.slice(index, index + 2), 16) / 255)
    .map(channel => channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.4 ? "#1f1f1f" : "#ffffff";
}

export function WalletPreview({ voucher, logoUrl, heroUrl }: { voucher: PreviewVoucher; logoUrl: string | null; heroUrl: string | null }) {
  const labels = voucherLabels[voucher.language] ?? voucherLabels.ro;
  const color = walletTextColor(voucher.background_color);
  const validity = voucher.starts_at && voucher.expires_at ? validityLabel(voucher) : "—";
  return (
    <div className="dv-wallet" style={{ background: voucher.background_color, color }} aria-label="Google Wallet preview">
      <div className="dv-wallet-head">
        <span className="dv-wallet-logo">{logoUrl ? <img src={logoUrl} alt="" /> : <span>{voucher.brand.slice(0, 1) || "?"}</span>}</span>
        <span className="dv-wallet-issuer">{voucher.brand || "Brand"}</span>
      </div>
      <div className="dv-wallet-title">{voucher.title || voucher.name || "Campaign title"}</div>
      <div className="dv-wallet-fields">
        {voucher.show_discount_value && voucher.discount_value > 0 && <div><small>{labels.benefit}</small><span>{benefitLabel(voucher)} {labels.discount}</span></div>}
        {voucher.show_discount_code && <div><small>{labels.code}</small><span>{voucher.discount_code || "—"}</span></div>}
        <div><small>{labels.validity}</small><span>{validity}</span></div>
      </div>
      {voucher.show_discount_code && <div className="dv-wallet-barcode"><span className="dv-wallet-qr" aria-hidden="true" /><small>{voucher.discount_code}</small></div>}
      {heroUrl && <img className="dv-wallet-hero" src={heroUrl} alt="" />}
      <div className="dv-wallet-details">
        <span>{labels.shop} ›</span>
        <span>Details: {[voucher.subtitle, voucher.short_description].filter(Boolean).join(" · ").slice(0, 90) || "—"}</span>
        {voucher.terms && <span>{labels.terms} ›</span>}
      </div>
    </div>
  );
}
