"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { createClient } from "@/lib/supabase/client";
import { slugify, type FieldErrors } from "@/lib/vouchers/validate";
import { discountTypes, qrDestination, shopUrl, campaignUtm, utcToZoned, voucherLanguages, zonedToUtc, type DiscountType, type Voucher, type VoucherLanguage } from "@/lib/vouchers/voucher";
import { discardUpload, saveVoucher } from "./actions";
import { CopyButton } from "./copy-button";
import { WalletPreview } from "./preview";

// Create / edit form, in three sections, with the live Wallet preview beside it. Dates are typed in the
// campaign's time zone (Europe/Bucharest); images go to the public voucher bucket (Google fetches them).

const bucket = "digital-voucher-assets";
type Tab = "general" | "design" | "distribution";

type Values = {
  name: string; internalName: string; brand: string; slug: string; discountCode: string; discountType: DiscountType; discountValue: string;
  currency: string; shortDescription: string; longDescription: string; startsAt: string; expiresAt: string; timezone: string;
  language: VoucherLanguage; terms: string; internalNotes: string;
  logoPath: string; heroPath: string; backgroundColor: string; textColor: string; accentColor: string; title: string; subtitle: string;
  showDiscountValue: boolean; showDiscountCode: boolean;
  websiteUrl: string; landingUrl: string; discountUrl: string; qrUrl: string; utmSource: string; utmMedium: string; utmCampaign: string;
  extraOrigins: string; googleWalletEnabled: boolean; appleWalletEnabled: boolean; imageDownloadEnabled: boolean; emailEnabled: boolean;
  published: boolean;
};

const empty: Values = {
  name: "", internalName: "", brand: "", slug: "", discountCode: "", discountType: "percentage", discountValue: "", currency: "",
  shortDescription: "", longDescription: "", startsAt: "", expiresAt: "", timezone: "Europe/Bucharest", language: "ro", terms: "", internalNotes: "",
  logoPath: "", heroPath: "", backgroundColor: "#651F2C", textColor: "#F5EEE4", accentColor: "#D8BE98", title: "", subtitle: "",
  showDiscountValue: true, showDiscountCode: true, websiteUrl: "", landingUrl: "", discountUrl: "", qrUrl: "",
  utmSource: "", utmMedium: "", utmCampaign: "", extraOrigins: "",
  googleWalletEnabled: false, appleWalletEnabled: false, imageDownloadEnabled: true, emailEnabled: false, published: false,
};

function fromVoucher(voucher: Voucher): Values {
  return {
    name: voucher.name, internalName: voucher.internal_name, brand: voucher.brand, slug: voucher.slug, discountCode: voucher.discount_code,
    discountType: voucher.discount_type, discountValue: String(voucher.discount_value), currency: voucher.currency ?? "",
    shortDescription: voucher.short_description, longDescription: voucher.long_description,
    startsAt: utcToZoned(voucher.starts_at, voucher.timezone), expiresAt: utcToZoned(voucher.expires_at, voucher.timezone),
    timezone: voucher.timezone, language: voucher.language, terms: voucher.terms, internalNotes: voucher.internal_notes,
    logoPath: voucher.logo_path ?? "", heroPath: voucher.hero_path ?? "", backgroundColor: voucher.background_color, textColor: voucher.text_color,
    accentColor: voucher.accent_color, title: voucher.title, subtitle: voucher.subtitle,
    showDiscountValue: voucher.show_discount_value, showDiscountCode: voucher.show_discount_code,
    websiteUrl: voucher.website_url ?? "", landingUrl: voucher.landing_url ?? "", discountUrl: voucher.discount_url ?? "", qrUrl: voucher.qr_url ?? "",
    utmSource: voucher.utm_source, utmMedium: voucher.utm_medium, utmCampaign: voucher.utm_campaign, extraOrigins: voucher.extra_origins.join("\n"),
    googleWalletEnabled: voucher.google_wallet_enabled, appleWalletEnabled: voucher.apple_wallet_enabled,
    imageDownloadEnabled: voucher.image_download_enabled, emailEnabled: voucher.email_enabled, published: voucher.published,
  };
}

function FieldError({ errors, name }: { errors: FieldErrors; name: string }) {
  return errors[name] ? <span className="hc-field-error" role="alert">{errors[name]}</span> : null;
}

const tabFields: Record<Tab, string[]> = {
  general: ["name", "internalName", "brand", "slug", "discountCode", "discountType", "discountValue", "currency", "shortDescription", "longDescription", "startsAt", "expiresAt", "timezone", "language", "terms", "internalNotes"],
  design: ["logoPath", "heroPath", "backgroundColor", "textColor", "accentColor", "title", "subtitle"],
  distribution: ["websiteUrl", "landingUrl", "discountUrl", "qrUrl", "utmSource", "utmMedium", "utmCampaign", "extraOrigins"],
};

export function VoucherForm({ voucher, assetBase, appleConfigured }: { voucher: Voucher | null; assetBase: string; appleConfigured: boolean }) {
  const router = useRouter();
  const start = voucher ? fromVoucher(voucher) : empty;
  const [values, setValues] = useState<Values>(start);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [message, setMessage] = useState<{ kind: "error" | "warning"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState<"" | "logoPath" | "heroPath">("");
  const [tab, setTab] = useState<Tab>("general");
  const [slugTouched, setSlugTouched] = useState(Boolean(voucher));
  const uploads = useRef<string[]>([]);
  const saved = useRef(false);
  const dirty = JSON.stringify(values) !== JSON.stringify(start);

  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => { if (dirty && !saved.current) event.preventDefault(); };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const set = <K extends keyof Values>(key: K, value: Values[K]) => setValues(current => ({ ...current, [key]: value }));
  const field = (key: Exclude<keyof Values, `${string}Enabled` | "published" | "showDiscountValue" | "showDiscountCode">) => ({
    value: values[key] as string, "aria-invalid": errors[key] ? true : undefined, id: `dv-${key}`,
    onChange: (event: { target: { value: string } }) => set(key, event.target.value as never),
  });
  const check = (key: "googleWalletEnabled" | "appleWalletEnabled" | "imageDownloadEnabled" | "emailEnabled" | "published" | "showDiscountValue" | "showDiscountCode") => ({
    checked: values[key], onChange: (event: { target: { checked: boolean } }) => set(key, event.target.checked),
  });
  const assetUrl = (path: string) => path ? `${assetBase}/${path}` : null;

  async function upload(key: "logoPath" | "heroPath", file: File | undefined) {
    if (!file) return;
    if (!/^image\/(jpeg|png)$/.test(file.type)) { setErrors(current => ({ ...current, [key]: "Choose a JPG or PNG image." })); return; }
    if (file.size > 5 * 1024 * 1024) { setErrors(current => ({ ...current, [key]: "The image can be at most 5 MB." })); return; }
    setUploading(key);
    try {
      const path = `vouchers/${crypto.randomUUID()}.${file.type === "image/png" ? "png" : "jpg"}`;
      const { error } = await createClient().storage.from(bucket).upload(path, file, { contentType: file.type, upsert: false });
      if (error) throw error;
      uploads.current.push(path);
      set(key, path);
      setErrors(current => { const next = { ...current }; delete next[key]; return next; });
    } catch {
      setErrors(current => ({ ...current, [key]: "The image could not be uploaded. Try again." }));
    } finally {
      setUploading("");
    }
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setMessage(null);
    let result: Awaited<ReturnType<typeof saveVoucher>>;
    try {
      result = await saveVoucher(voucher?.id ?? null, values);
    } catch {
      result = { ok: false, error: "Could not save. Check your internet connection and try again." };
    }
    setBusy(false);
    if (!result.ok) {
      const fieldErrors = result.errors ?? {};
      setErrors(fieldErrors);
      setMessage({ kind: "error", text: result.error });
      const first = (Object.keys(tabFields) as Tab[]).find(name => tabFields[name].some(key => fieldErrors[key]));
      if (first) setTab(first);
      return;
    }
    for (const path of uploads.current) if (path !== values.logoPath && path !== values.heroPath) void discardUpload(path);
    saved.current = true;
    router.push(`/vouchers/${result.value.id}${result.warning ? `?warning=${encodeURIComponent(result.warning)}` : "?notice=saved"}`);
    router.refresh();
  }

  // The preview reads the same values; dates are converted back to instants the way the server does.
  const startsIso = zonedToUtc(values.startsAt, values.timezone);
  const expiresIso = zonedToUtc(values.expiresAt, values.timezone);
  const previewVoucher = {
    brand: values.brand, name: values.name, title: values.title, subtitle: values.subtitle, discount_code: values.discountCode.toUpperCase(),
    discount_type: values.discountType, discount_value: Number(values.discountValue.replace(",", ".")) || 0, currency: values.currency || null,
    starts_at: startsIso ?? "", expires_at: expiresIso ?? "", timezone: values.timezone, language: values.language,
    background_color: /^#[0-9A-Fa-f]{6}$/.test(values.backgroundColor) ? values.backgroundColor : "#651F2C",
    show_discount_value: values.showDiscountValue, show_discount_code: values.showDiscountCode,
    short_description: values.shortDescription, long_description: values.longDescription, terms: values.terms,
  };
  const linkSource = {
    discount_url: values.discountUrl || null, landing_url: values.landingUrl || null, website_url: values.websiteUrl || null, qr_url: values.qrUrl || null,
    utm_source: values.utmSource, utm_medium: values.utmMedium, utm_campaign: values.utmCampaign,
  };
  const shop = shopUrl(linkSource, campaignUtm(linkSource));
  const qr = qrDestination(linkSource);

  const section = (name: Tab, label: string) => (
    <button type="button" role="tab" aria-selected={tab === name} className={tab === name ? "active" : ""} onClick={() => setTab(name)}>
      {label}{tabFields[name].some(key => errors[key]) && <span className="dv-tab-error" aria-label="has errors">!</span>}
    </button>
  );
  const color = (key: "backgroundColor" | "textColor" | "accentColor", label: string) => (
    <label>{label}
      <span className="dv-color"><input type="color" value={/^#[0-9A-Fa-f]{6}$/.test(values[key]) ? values[key] : "#000000"} onChange={event => set(key, event.target.value.toUpperCase())} aria-label={`${label} picker`} />
        <input {...field(key)} maxLength={7} /></span>
      <FieldError errors={errors} name={key} /></label>
  );
  const image = (key: "logoPath" | "heroPath", label: string, hint: string) => (
    <div className="dv-image-field">
      <span className="dv-label">{label}</span>
      <span className={`dv-image-box ${key === "logoPath" ? "logo" : "hero"}`} style={{ background: values.backgroundColor }}>
        {values[key] ? <img src={assetUrl(values[key]) ?? ""} alt="" /> : <span>No image</span>}
      </span>
      <span className="dv-image-actions">
        <label className={`button button-outline ${uploading === key ? "is-busy" : ""}`}>
          {uploading === key && <span className="busy-spinner" aria-hidden="true" />}{values[key] ? "Replace" : "Upload"}
          <input type="file" accept="image/jpeg,image/png" hidden disabled={Boolean(uploading)} onChange={event => { void upload(key, event.target.files?.[0]); event.target.value = ""; }} />
        </label>
        {values[key] && <button type="button" className="button danger-outline" onClick={() => set(key, "")}>Remove</button>}
      </span>
      <small>{hint}</small>
      <FieldError errors={errors} name={key} />
    </div>
  );

  let body: ReactNode;
  if (tab === "general") body = (
    <fieldset className="dv-fields">
      <label className="dv-wide" htmlFor="dv-name">Campaign name *<input {...field("name")} maxLength={120} onChange={event => { const name = event.target.value; setValues(current => ({ ...current, name, slug: slugTouched ? current.slug : slugify(name) })); }} /><FieldError errors={errors} name="name" /></label>
      <label htmlFor="dv-internalName">Internal name<input {...field("internalName")} maxLength={120} /><small>Only in BoldHub.</small><FieldError errors={errors} name="internalName" /></label>
      <label htmlFor="dv-brand">Brand *<input {...field("brand")} maxLength={60} placeholder="e.g. Atelier Rebul" /><FieldError errors={errors} name="brand" /></label>
      <label htmlFor="dv-slug">Campaign slug *<input {...field("slug")} maxLength={60} onChange={event => { setSlugTouched(true); set("slug", event.target.value.toLowerCase()); }} /><small>Used in the public API address.</small><FieldError errors={errors} name="slug" /></label>
      <label htmlFor="dv-discountCode">Discount code *<input {...field("discountCode")} maxLength={40} onChange={event => set("discountCode", event.target.value.toUpperCase())} /><small>Exactly as in Shopify. BoldHub does not create or change it.</small><FieldError errors={errors} name="discountCode" /></label>
      <label htmlFor="dv-discountType">Discount type *<select {...field("discountType")}>{(Object.keys(discountTypes) as DiscountType[]).map(type => <option key={type} value={type}>{discountTypes[type]}</option>)}</select><FieldError errors={errors} name="discountType" /></label>
      <label htmlFor="dv-discountValue">Discount value *<input {...field("discountValue")} inputMode="decimal" placeholder={values.discountType === "percentage" ? "e.g. 25" : "e.g. 50"} /><FieldError errors={errors} name="discountValue" /></label>
      {values.discountType === "fixed_amount" && <label htmlFor="dv-currency">Currency *<select {...field("currency")}><option value="">Choose</option>{["RON", "EUR", "USD", "GBP"].map(code => <option key={code}>{code}</option>)}</select><FieldError errors={errors} name="currency" /></label>}
      <label htmlFor="dv-startsAt">Start date and time *<input {...field("startsAt")} type="datetime-local" step={1} /><FieldError errors={errors} name="startsAt" /></label>
      <label htmlFor="dv-expiresAt">Expiration date and time *<input {...field("expiresAt")} type="datetime-local" step={1} /><FieldError errors={errors} name="expiresAt" /></label>
      <label htmlFor="dv-timezone">Time zone<select {...field("timezone")}><option value="Europe/Bucharest">Europe/Bucharest</option></select><small>Dates are typed and shown in this zone.</small></label>
      <label htmlFor="dv-language">Voucher language<select {...field("language")}>{(Object.keys(voucherLanguages) as VoucherLanguage[]).map(code => <option key={code} value={code}>{voucherLanguages[code]}</option>)}</select><small>Field names in Wallet and on the image.</small></label>
      <label className="dv-wide" htmlFor="dv-shortDescription">Short description<textarea {...field("shortDescription")} rows={2} maxLength={300} /><FieldError errors={errors} name="shortDescription" /></label>
      <label className="dv-wide" htmlFor="dv-longDescription">Long description<textarea {...field("longDescription")} rows={3} maxLength={2000} /><FieldError errors={errors} name="longDescription" /></label>
      <label className="dv-wide" htmlFor="dv-terms">Terms and conditions<textarea {...field("terms")} rows={4} maxLength={3000} /><small>Shown in Wallet as the fine print and on the landing page.</small><FieldError errors={errors} name="terms" /></label>
      <label className="dv-wide" htmlFor="dv-internalNotes">Internal notes<textarea {...field("internalNotes")} rows={2} maxLength={3000} /><small>Never shown to customers.</small><FieldError errors={errors} name="internalNotes" /></label>
    </fieldset>
  );
  else if (tab === "design") body = (
    <fieldset className="dv-fields">
      {image("logoPath", "Brand logo", "Square PNG/JPG, at least 660 × 660 px. Google shows it in a circle.")}
      {image("heroPath", "Hero image", "Wide PNG/JPG, 1032 × 336 px recommended. Also the top of the downloadable image.")}
      <label className="dv-wide" htmlFor="dv-title">Campaign title<input {...field("title")} maxLength={80} placeholder="e.g. Un cadou pentru tine" /><FieldError errors={errors} name="title" /></label>
      <label className="dv-wide" htmlFor="dv-subtitle">Campaign subtitle<input {...field("subtitle")} maxLength={160} /><FieldError errors={errors} name="subtitle" /></label>
      {color("backgroundColor", "Background colour")}
      {color("textColor", "Text colour")}
      {color("accentColor", "Accent colour")}
      <div className="dv-checks dv-wide">
        <label className="hc-check"><input type="checkbox" {...check("showDiscountValue")} />Display discount value</label>
        <label className="hc-check"><input type="checkbox" {...check("showDiscountCode")} />Display discount code</label>
      </div>
      <p className="dv-note dv-wide">Google Wallet uses the background colour, logo, hero image, title and fields. It chooses the text colour itself (white or black); the text and accent colours apply to the downloadable image and the landing page.</p>
    </fieldset>
  );
  else body = (
    <fieldset className="dv-fields">
      <label className="dv-wide" htmlFor="dv-websiteUrl">Website URL<input {...field("websiteUrl")} placeholder="https://" /><FieldError errors={errors} name="websiteUrl" /></label>
      <label className="dv-wide" htmlFor="dv-landingUrl">Landing page URL<input {...field("landingUrl")} placeholder="https://" /><FieldError errors={errors} name="landingUrl" /></label>
      <label className="dv-wide" htmlFor="dv-discountUrl">Discount application URL<input {...field("discountUrl")} placeholder="https://shop/discount/CODE?redirect=/collections/all" /><small>Opens the shop with the code applied. UTM tags go on the page it redirects to.</small><FieldError errors={errors} name="discountUrl" /></label>
      <label className="dv-wide" htmlFor="dv-qrUrl">QR destination URL<input {...field("qrUrl")} placeholder="https://" /><FieldError errors={errors} name="qrUrl" /></label>
      <label htmlFor="dv-utmSource">UTM source<input {...field("utmSource")} maxLength={60} /><FieldError errors={errors} name="utmSource" /></label>
      <label htmlFor="dv-utmMedium">UTM medium<input {...field("utmMedium")} maxLength={60} /><FieldError errors={errors} name="utmMedium" /></label>
      <label className="dv-wide" htmlFor="dv-utmCampaign">UTM campaign<input {...field("utmCampaign")} maxLength={80} /><FieldError errors={errors} name="utmCampaign" /></label>
      <label className="dv-wide" htmlFor="dv-extraOrigins">Extra sites allowed to use the public API<textarea {...field("extraOrigins")} rows={2} placeholder="https://your-store.myshopify.com" /><small>One per line. The website, landing page and discount link are always allowed.</small><FieldError errors={errors} name="extraOrigins" /></label>
      <div className="dv-links dv-wide">
        <div><small>Shop link (with UTM)</small><code>{shop ?? "—"}</code>{shop && <CopyButton value={shop} label="Copy" />}</div>
        <div><small>QR destination (with UTM)</small><code>{qr ?? "—"}</code>{qr && <CopyButton value={qr} label="Copy" />}</div>
        <div><small>Discount code</small><code>{values.discountCode || "—"}</code>{values.discountCode && <CopyButton value={values.discountCode} label="Copy" />}</div>
      </div>
      <div className="dv-checks dv-wide">
      <label className="hc-check"><input type="checkbox" {...check("googleWalletEnabled")} />Enable Google Wallet</label>
      <label className="hc-check" title={appleConfigured ? undefined : "Apple Wallet is not configured yet."}><input type="checkbox" {...check("appleWalletEnabled")} disabled={!appleConfigured && !values.appleWalletEnabled} />Enable Apple Wallet {!appleConfigured && <em className="dv-muted">(not configured)</em>}</label>
      <label className="hc-check"><input type="checkbox" {...check("imageDownloadEnabled")} />Enable image download</label>
      <label className="hc-check" title="E-mail delivery will be configured later."><input type="checkbox" {...check("emailEnabled")} disabled={!values.emailEnabled} />Enable email delivery <em className="dv-muted">(later)</em></label>
      </div>
    </fieldset>
  );

  return (
    <form className="dv-editor hc-editor" onSubmit={submit} noValidate>
      <div className="dv-editor-main admin-card">
        <div className="hc-tabs dv-tabs" role="tablist">{section("general", "General")}{section("design", "Design")}{section("distribution", "Distribution")}</div>
        {body}
        <footer className="dv-form-footer">
          <label className="hc-check"><input type="checkbox" {...check("published")} />Published <small>(off = Draft, invisible to the public API)</small></label>
          {message && <span className={message.kind === "error" ? "hc-field-error" : "dv-warning"} role="alert">{message.text}</span>}
          <Link className="button button-outline" href={voucher ? `/vouchers/${voucher.id}` : "/vouchers/list"}>Cancel</Link>
          <button type="submit" className={`button button-primary ${busy ? "is-busy" : ""}`} disabled={busy || Boolean(uploading)}>{busy && <span className="busy-spinner" aria-hidden="true" />}{voucher ? "Save changes" : "Create voucher"}</button>
        </footer>
      </div>
      <aside className="dv-editor-preview">
        <h2>Live preview · Google Wallet</h2>
        <WalletPreview voucher={previewVoucher} logoUrl={assetUrl(values.logoPath)} heroUrl={assetUrl(values.heroPath)} />
        <p className="dv-note">An approximation of the pass. Google decides the final layout and text colour.</p>
      </aside>
    </form>
  );
}
