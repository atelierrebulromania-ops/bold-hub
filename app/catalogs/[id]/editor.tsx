"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState, type DragEvent, type FormEvent } from "react";
import {
  catalogCurrencies, catalogLanguages, defaultCatalogTexts, formatPrice, formatSize, sizeUnits,
  type CatalogCollection, type CatalogData, type CatalogProduct, type SizeUnit,
} from "@/lib/horeca/catalog";
import type { FieldErrors } from "@/lib/horeca/validate";
import { createClient } from "@/lib/supabase/client";
import {
  addCollection, deleteCollection, deleteProduct, discardUpload, duplicateProduct, reorderCollections, reorderProducts,
  saveCatalogInfo, saveProduct, setCollectionActive, setProductActive, updateCollection, type ActionResult,
} from "./actions";

// The catalog editor. Every change is saved right away through a server action; the badge at the top
// says whether everything is saved. Unsaved typing (catalog info, an open product window) is guarded
// against leaving the page.

type Status = { kind: "saved" } | { kind: "saving" } | { kind: "error"; message: string };
type Tab = "products" | "info";

const bucket = "horeca-catalog-images";
const byPosition = <T extends { position: number }>(items: T[]) => [...items].sort((a, b) => a.position - b.position);
const imageUrl = (path: string) => `/catalogs/image?path=${encodeURIComponent(path)}`;

export function CatalogEditor({ initial }: { initial: CatalogData }) {
  const catalogId = initial.id;
  const [collections, setCollections] = useState<CatalogCollection[]>(initial.collections);
  const [products, setProducts] = useState<CatalogProduct[]>(initial.products);
  const [currency, setCurrency] = useState(initial.currency);
  const [tab, setTab] = useState<Tab>("products");
  const [status, setStatus] = useState<Status>({ kind: "saved" });
  const [infoDirty, setInfoDirty] = useState(false);
  const [dialog, setDialog] = useState<{ product: CatalogProduct | null; collectionId: string } | null>(null);
  const [dialogDirty, setDialogDirty] = useState(false);
  const pending = useRef(0);

  // Runs one save and keeps the status badge honest. Returns the result so callers can roll back.
  const save = useCallback(async <T,>(action: () => Promise<ActionResult<T>>): Promise<ActionResult<T>> => {
    pending.current += 1;
    setStatus({ kind: "saving" });
    let result: ActionResult<T>;
    try {
      result = await action();
    } catch {
      result = { ok: false, error: "Nu s-a putut salva. Verifică legătura la internet și încearcă din nou." };
    }
    pending.current -= 1;
    if (!result.ok) setStatus({ kind: "error", message: result.error });
    else if (pending.current === 0) setStatus({ kind: "saved" });
    return result;
  }, []);

  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (infoDirty || dialogDirty || pending.current > 0) event.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [infoDirty, dialogDirty]);

  const sortedCollections = byPosition(collections);
  const productsOf = (collectionId: string) => byPosition(products.filter(product => product.collection_id === collectionId));

  // ---- Collections ----
  async function moveCollection(index: number, offset: number) {
    const order = sortedCollections.map(collection => collection.id);
    const target = index + offset;
    if (target < 0 || target >= order.length) return;
    [order[index], order[target]] = [order[target], order[index]];
    const before = collections;
    setCollections(collections.map(collection => ({ ...collection, position: order.indexOf(collection.id) + 1 })));
    const result = await save(() => reorderCollections(catalogId, order));
    if (!result.ok) setCollections(before);
  }

  async function toggleCollection(collection: CatalogCollection) {
    const before = collections;
    setCollections(collections.map(item => item.id === collection.id ? { ...item, active: !collection.active } : item));
    const result = await save(() => setCollectionActive(catalogId, collection.id, !collection.active));
    if (!result.ok) setCollections(before);
  }

  async function removeCollection(collection: CatalogCollection) {
    const count = productsOf(collection.id).length;
    const message = count > 0
      ? `Ștergi colecția „${collection.name}” și cele ${count} produse din ea? Nu se poate anula.`
      : `Ștergi colecția „${collection.name}”? Nu se poate anula.`;
    if (!window.confirm(message)) return;
    const result = await save(() => deleteCollection(catalogId, collection.id));
    if (result.ok) {
      setCollections(collections.filter(item => item.id !== collection.id));
      setProducts(products.filter(product => product.collection_id !== collection.id));
    }
  }

  // ---- Products ----
  async function moveProduct(collectionId: string, from: number, to: number) {
    const list = productsOf(collectionId);
    if (to < 0 || to >= list.length || from === to) return;
    const order = list.map(product => product.id);
    const [moved] = order.splice(from, 1);
    order.splice(to, 0, moved);
    const before = products;
    setProducts(products.map(product => product.collection_id === collectionId ? { ...product, position: order.indexOf(product.id) + 1 } : product));
    const result = await save(() => reorderProducts(catalogId, collectionId, order));
    if (!result.ok) setProducts(before);
  }

  async function toggleProduct(product: CatalogProduct) {
    const before = products;
    setProducts(products.map(item => item.id === product.id ? { ...item, active: !product.active } : item));
    const result = await save(() => setProductActive(catalogId, product.id, !product.active));
    if (!result.ok) setProducts(before);
  }

  async function copyProduct(product: CatalogProduct) {
    const result = await save(() => duplicateProduct(catalogId, product.id));
    if (result.ok) setProducts(current => [...current, result.value]);
  }

  async function removeProduct(product: CatalogProduct) {
    if (!window.confirm(`Ștergi produsul „${product.name}”? Nu se poate anula. Dacă vrei doar să nu apară în PDF, folosește „Ascunde”.`)) return;
    const result = await save(() => deleteProduct(catalogId, product.id));
    if (result.ok) setProducts(current => current.filter(item => item.id !== product.id));
  }

  function productSaved(product: CatalogProduct) {
    setProducts(current => current.some(item => item.id === product.id)
      ? current.map(item => item.id === product.id ? product : item)
      : [...current, product]);
    setDialog(null);
    setDialogDirty(false);
  }

  return (
    <div className="hc-editor">
      <div className="hc-editor-head">
        <div>
          <Link href="/catalogs" className="hc-back">← Toate cataloagele</Link>
          <SaveBadge status={status} />
        </div>
        <div className="hc-editor-actions">
          <Link className="button button-outline" href={`/catalogs/${catalogId}/preview`}>Previzualizare</Link>
          <a className="button button-primary" href={`/catalogs/${catalogId}/pdf?download=1`}>Export PDF</a>
        </div>
      </div>

      <div className="hc-tabs" role="tablist" aria-label="Secțiuni catalog">
        <button type="button" role="tab" aria-selected={tab === "products"} onClick={() => setTab("products")}>Colecții și produse</button>
        <button type="button" role="tab" aria-selected={tab === "info"} onClick={() => setTab("info")}>Informații și condiții comerciale{infoDirty ? " •" : ""}</button>
      </div>

      {/* The info form stays mounted so unsaved typing survives switching tabs. */}
      <div hidden={tab !== "info"}>
        <InfoForm initial={initial} save={save} onDirty={setInfoDirty} onCurrency={setCurrency} />
      </div>

      <div hidden={tab !== "products"} className="hc-collections">
        {sortedCollections.length === 0 && <p className="hc-empty">Catalogul nu are încă nicio colecție. Adaugă prima colecție mai jos, apoi produsele ei.</p>}
        {sortedCollections.map((collection, index) => (
          <CollectionCard key={collection.id} catalogId={catalogId} collection={collection} products={productsOf(collection.id)} currency={currency}
            first={index === 0} last={index === sortedCollections.length - 1} save={save}
            onRenamed={(name, label) => setCollections(current => current.map(item => item.id === collection.id ? { ...item, name, label } : item))}
            onMove={offset => moveCollection(index, offset)} onToggle={() => toggleCollection(collection)} onDelete={() => removeCollection(collection)}
            onAdd={() => setDialog({ product: null, collectionId: collection.id })}
            onEdit={product => setDialog({ product, collectionId: product.collection_id })}
            onCopy={copyProduct} onToggleProduct={toggleProduct} onDeleteProduct={removeProduct}
            onMoveProduct={(from, to) => moveProduct(collection.id, from, to)} />
        ))}
        <NewCollection catalogId={catalogId} save={save} label={collections[0]?.label ?? defaultCatalogTexts[initial.language].label}
          onAdded={collection => setCollections(current => [...current, collection])} />
      </div>

      {dialog && <ProductDialog catalogId={catalogId} product={dialog.product} collectionId={dialog.collectionId} collections={sortedCollections}
        currency={currency} save={save} onDirty={setDialogDirty} onSaved={productSaved}
        onClose={() => { setDialog(null); setDialogDirty(false); }} />}
    </div>
  );
}

type Save = <T>(action: () => Promise<ActionResult<T>>) => Promise<ActionResult<T>>;

function SaveBadge({ status }: { status: Status }) {
  if (status.kind === "saving") return <span className="hc-status saving" role="status"><span className="busy-spinner" aria-hidden="true" />Se salvează…</span>;
  if (status.kind === "error") return <span className="hc-status error" role="alert">Nesalvat: {status.message}</span>;
  return <span className="hc-status saved" role="status">✓ Toate modificările sunt salvate</span>;
}

function FieldError({ errors, name }: { errors: FieldErrors; name: string }) {
  return errors[name] ? <span className="hc-field-error">{errors[name]}</span> : null;
}

// ---- Catalog info and commercial terms ----------------------------------------------------------------

const infoFields = ["title", "language", "currency", "coverTitle", "coverSubtitle", "website", "termsVat", "termsCurrency", "termsPayment", "termsDelivery", "termsOther"] as const;
type InfoValues = Record<(typeof infoFields)[number], string>;

function InfoForm({ initial, save, onDirty, onCurrency }: { initial: CatalogData; save: Save; onDirty: (dirty: boolean) => void; onCurrency: (currency: string) => void }) {
  const start: InfoValues = {
    title: initial.title, language: initial.language, currency: initial.currency, coverTitle: initial.cover_title, coverSubtitle: initial.cover_subtitle,
    website: initial.website, termsVat: initial.terms_vat ?? "", termsCurrency: initial.terms_currency ?? "", termsPayment: initial.terms_payment ?? "",
    termsDelivery: initial.terms_delivery ?? "", termsOther: initial.terms_other ?? "",
  };
  const [saved, setSaved] = useState(start);
  const [values, setValues] = useState(start);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [busy, setBusy] = useState(false);
  const dirty = infoFields.some(field => values[field] !== saved[field]);
  useEffect(() => onDirty(dirty), [dirty, onDirty]);

  const field = (name: keyof InfoValues) => ({
    name, value: values[name], "aria-invalid": errors[name] ? true : undefined,
    onChange: (event: { target: { value: string } }) => setValues(current => ({ ...current, [name]: event.target.value })),
  });

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    const result = await save(() => saveCatalogInfo(initial.id, values));
    setBusy(false);
    if (result.ok) { setSaved(values); setErrors({}); onCurrency(values.currency); }
    else setErrors(result.errors ?? {});
  }

  return (
    <form className="admin-card hc-info" onSubmit={submit} noValidate>
      <fieldset>
        <legend>Catalog</legend>
        <label className="hc-wide">Titlul catalogului (apare în listă și în fișa PDF) *<input {...field("title")} maxLength={120} required /><FieldError errors={errors} name="title" /></label>
        <label>Limba catalogului<select {...field("language")}>{Object.entries(catalogLanguages).map(([code, name]) => <option key={code} value={code}>{name}</option>)}</select>
          <small>Etichetele fixe din PDF (Preț, Volum, Cod) urmează limba aleasă.</small><FieldError errors={errors} name="language" /></label>
        <label>Moneda catalogului<select {...field("currency")}>{catalogCurrencies.map(code => <option key={code}>{code}</option>)}</select>
          <small>Produsele o preiau automat.</small><FieldError errors={errors} name="currency" /></label>
      </fieldset>
      <fieldset>
        <legend>Copertă și ultima pagină</legend>
        <label>Titlul de pe copertă<input {...field("coverTitle")} maxLength={40} /><FieldError errors={errors} name="coverTitle" /></label>
        <label>Subtitlul de pe copertă<input {...field("coverSubtitle")} maxLength={60} /><FieldError errors={errors} name="coverSubtitle" /></label>
        <label>Adresa site-ului (ultima pagină, cu link)<input {...field("website")} maxLength={80} /><FieldError errors={errors} name="website" /></label>
      </fieldset>
      <fieldset>
        <legend>Condiții comerciale (pagina a doua; rândurile goale nu apar)</legend>
        <label className="hc-wide">TVA<textarea {...field("termsVat")} rows={2} maxLength={600} /><FieldError errors={errors} name="termsVat" /></label>
        <label className="hc-wide">Monedă<textarea {...field("termsCurrency")} rows={2} maxLength={600} /><FieldError errors={errors} name="termsCurrency" /></label>
        <label className="hc-wide">Plată<textarea {...field("termsPayment")} rows={3} maxLength={600} /><FieldError errors={errors} name="termsPayment" /></label>
        <label className="hc-wide">Livrare<textarea {...field("termsDelivery")} rows={2} maxLength={600} /><FieldError errors={errors} name="termsDelivery" /></label>
        <label className="hc-wide">Alte mențiuni<textarea {...field("termsOther")} rows={2} maxLength={600} /><FieldError errors={errors} name="termsOther" /></label>
      </fieldset>
      <div className="hc-form-actions">
        {dirty && <span className="hc-unsaved">Ai modificări nesalvate.</span>}
        <button type="button" className="button button-outline" disabled={!dirty || busy} onClick={() => { setValues(saved); setErrors({}); }}>Renunță</button>
        <button type="submit" className={`button button-primary ${busy ? "is-busy" : ""}`} disabled={!dirty || busy}>{busy && <span className="busy-spinner" aria-hidden="true" />}Salvează</button>
      </div>
    </form>
  );
}

// ---- Collections ----------------------------------------------------------------------------------------

function NewCollection({ catalogId, save, label, onAdded }: { catalogId: string; save: Save; label: string; onAdded: (collection: CatalogCollection) => void }) {
  const [name, setName] = useState("");
  const [heading, setHeading] = useState(label);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    const result = await save(() => addCollection(catalogId, { name, label: heading }));
    setBusy(false);
    if (result.ok) { onAdded(result.value); setName(""); setErrors({}); }
    else setErrors(result.errors ?? {});
  }
  return (
    <form className="admin-card hc-new-collection" onSubmit={submit} noValidate>
      <h2>Colecție nouă</h2>
      <label>Numele colecției *<input value={name} onChange={event => setName(event.target.value)} maxLength={60} placeholder="ex. ISTANBUL" /><FieldError errors={errors} name="name" /></label>
      <label>Textul de deasupra numelui<input value={heading} onChange={event => setHeading(event.target.value)} maxLength={60} /><FieldError errors={errors} name="label" /></label>
      <button type="submit" className={`button button-primary ${busy ? "is-busy" : ""}`} disabled={busy}>{busy && <span className="busy-spinner" aria-hidden="true" />}Adaugă colecția</button>
    </form>
  );
}

function CollectionCard(props: {
  catalogId: string; collection: CatalogCollection; products: CatalogProduct[]; currency: string; first: boolean; last: boolean; save: Save;
  onRenamed: (name: string, label: string) => void; onMove: (offset: number) => void; onToggle: () => void; onDelete: () => void;
  onAdd: () => void; onEdit: (product: CatalogProduct) => void; onCopy: (product: CatalogProduct) => void;
  onToggleProduct: (product: CatalogProduct) => void; onDeleteProduct: (product: CatalogProduct) => void; onMoveProduct: (from: number, to: number) => void;
}) {
  const { collection, products } = props;
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(collection.name);
  const [label, setLabel] = useState(collection.label);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [dragged, setDragged] = useState<number | null>(null);
  const [over, setOver] = useState<number | null>(null);

  async function rename(event: FormEvent) {
    event.preventDefault();
    const result = await props.save(() => updateCollection(props.catalogId, collection.id, { name, label }));
    if (result.ok) { props.onRenamed(name.trim().replace(/\s+/g, " "), label.trim().replace(/\s+/g, " ")); setRenaming(false); setErrors({}); }
    else setErrors(result.errors ?? {});
  }

  const dragProps = (index: number) => ({
    draggable: true,
    onDragStart: (event: DragEvent) => { setDragged(index); event.dataTransfer.effectAllowed = "move"; event.dataTransfer.setData("text/plain", String(index)); },
    onDragOver: (event: DragEvent) => { if (dragged !== null) { event.preventDefault(); setOver(index); } },
    onDragLeave: () => setOver(current => current === index ? null : current),
    onDrop: (event: DragEvent) => { event.preventDefault(); if (dragged !== null) props.onMoveProduct(dragged, index); setDragged(null); setOver(null); },
    onDragEnd: () => { setDragged(null); setOver(null); },
  });

  return (
    <section className={`admin-card hc-collection ${collection.active ? "" : "is-hidden"}`} aria-label={`Colecția ${collection.name}`}>
      <header className="hc-collection-head">
        <div className="hc-order" aria-label="Ordinea colecției">
          <button type="button" className="hc-icon" onClick={() => props.onMove(-1)} disabled={props.first} aria-label="Mută colecția mai sus" title="Mai sus">↑</button>
          <button type="button" className="hc-icon" onClick={() => props.onMove(1)} disabled={props.last} aria-label="Mută colecția mai jos" title="Mai jos">↓</button>
        </div>
        {renaming
          ? <form className="hc-rename" onSubmit={rename} noValidate>
              <label>Text deasupra<input value={label} onChange={event => setLabel(event.target.value)} maxLength={60} /><FieldError errors={errors} name="label" /></label>
              <label>Nume colecție *<input value={name} onChange={event => setName(event.target.value)} maxLength={60} autoFocus /><FieldError errors={errors} name="name" /></label>
              <button type="submit" className="button button-primary">Salvează</button>
              <button type="button" className="button button-outline" onClick={() => { setRenaming(false); setName(collection.name); setLabel(collection.label); setErrors({}); }}>Renunță</button>
            </form>
          : <div className="hc-collection-title">
              {collection.label && <small>{collection.label}</small>}
              <h2>{collection.name}</h2>
              {!collection.active
                ? <span className="outcome-chip inactive">Ascunsă în PDF</span>
                : products.some(product => product.active)
                  ? <span className="outcome-chip ok">Apare în PDF</span>
                  : <span className="outcome-chip remarks">Nu apare: fără produse vizibile</span>}
              <span className="hc-count">{products.length} {products.length === 1 ? "produs" : "produse"}</span>
            </div>}
        {!renaming && <div className="hc-collection-actions">
          <button type="button" className="button button-outline" onClick={() => setRenaming(true)}>Redenumește</button>
          <button type="button" className="button button-outline" onClick={props.onToggle}>{collection.active ? "Ascunde" : "Arată"}</button>
          <button type="button" className="button danger-outline" onClick={props.onDelete}>Șterge</button>
        </div>}
      </header>

      {products.length === 0
        ? <p className="hc-empty">Colecția nu are produse. O colecție fără produse active nu apare în PDF.</p>
        : <ul className="hc-products">
            {products.map((product, index) => (
              <li key={product.id} className={`hc-product ${product.active ? "" : "is-hidden"} ${over === index && dragged !== index ? "is-over" : ""} ${dragged === index ? "is-dragged" : ""}`} {...dragProps(index)}>
                <span className="hc-grip" aria-hidden="true" title="Trage pentru a schimba ordinea">⋮⋮</span>
                <span className="hc-thumb">{product.image_path ? <img src={imageUrl(product.image_path)} alt="" loading="lazy" /> : <span>Fără foto</span>}</span>
                <span className="hc-product-main">
                  <strong>{product.name}</strong>
                  <span>{formatPrice(product.price, product.currency ?? props.currency)}{formatSize(product.size_value, product.size_unit) ? ` · ${formatSize(product.size_value, product.size_unit)}` : ""}{product.sku ? ` · ${product.sku}` : ""}</span>
                  {!product.active && <span className="outcome-chip inactive">Ascuns în PDF</span>}
                </span>
                <span className="hc-product-actions">
                  <button type="button" className="hc-icon" onClick={() => props.onMoveProduct(index, index - 1)} disabled={index === 0} aria-label={`Mută ${product.name} mai sus`} title="Mai sus">↑</button>
                  <button type="button" className="hc-icon" onClick={() => props.onMoveProduct(index, index + 1)} disabled={index === products.length - 1} aria-label={`Mută ${product.name} mai jos`} title="Mai jos">↓</button>
                  <button type="button" className="button button-outline" onClick={() => props.onEdit(product)}>Editează</button>
                  <button type="button" className="button button-outline" onClick={() => props.onCopy(product)}>Duplică</button>
                  <button type="button" className="button button-outline" onClick={() => props.onToggleProduct(product)}>{product.active ? "Ascunde" : "Arată"}</button>
                  <button type="button" className="button danger-outline" onClick={() => props.onDeleteProduct(product)}>Șterge</button>
                </span>
              </li>
            ))}
          </ul>}
      <button type="button" className="button button-primary hc-add" onClick={props.onAdd}>+ Adaugă produs în {collection.name}</button>
    </section>
  );
}

// ---- Product window ---------------------------------------------------------------------------------------

type ProductValues = { name: string; collectionId: string; price: string; currency: string; sizeValue: string; sizeUnit: string; sku: string; imagePath: string; active: boolean };

// Resizes a photo in the browser (longest side 1600 px) and stores it as JPEG on white, so any photo the
// user picks lands in the bucket in the one format the template expects, at a sensible size.
async function preparePhoto(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const context = canvas.getContext("2d");
  if (!context) throw new Error("canvas");
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return new Promise((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error("blob")), "image/jpeg", 0.9));
}

function ProductDialog({ catalogId, product, collectionId, collections, currency, save, onDirty, onSaved, onClose }: {
  catalogId: string; product: CatalogProduct | null; collectionId: string; collections: CatalogCollection[]; currency: string; save: Save;
  onDirty: (dirty: boolean) => void; onSaved: (product: CatalogProduct) => void; onClose: () => void;
}) {
  const start: ProductValues = {
    name: product?.name ?? "", collectionId, price: product ? product.price.toFixed(2) : "", currency: product?.currency ?? "",
    sizeValue: product?.size_value === null || product?.size_value === undefined ? "" : String(product.size_value), sizeUnit: product?.size_unit ?? "ml",
    sku: product?.sku ?? "", imagePath: product?.image_path ?? "", active: product?.active ?? true,
  };
  const [values, setValues] = useState(start);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const uploads = useRef<string[]>([]);
  const dialog = useRef<HTMLDialogElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const dirty = (Object.keys(start) as (keyof ProductValues)[]).some(key => values[key] !== start[key]);
  useEffect(() => onDirty(dirty), [dirty, onDirty]);
  useEffect(() => { dialog.current?.showModal(); }, []);

  const set = <K extends keyof ProductValues>(key: K, value: ProductValues[K]) => setValues(current => ({ ...current, [key]: value }));
  const text = (key: Exclude<keyof ProductValues, "active">) => ({
    value: values[key], "aria-invalid": errors[key] ? true : undefined, onChange: (event: { target: { value: string } }) => set(key, event.target.value),
  });

  // Photos uploaded in this window but not kept are removed again (only if no product uses them).
  function discard(except: string) {
    for (const path of uploads.current) if (path !== except) void discardUpload(catalogId, path);
    uploads.current = [];
  }

  function close() {
    if (dirty && !window.confirm("Închizi fereastra fără să salvezi modificările?")) return;
    discard("");
    onClose();
  }

  async function pickPhoto(file: File | undefined) {
    if (!file) return;
    if (!/^image\/(jpeg|png|webp)$/.test(file.type)) { setErrors(current => ({ ...current, imagePath: "Alege o fotografie JPG, PNG sau WEBP." })); return; }
    if (file.size > 25 * 1024 * 1024) { setErrors(current => ({ ...current, imagePath: "Fotografia este prea mare (cel mult 25 MB)." })); return; }
    setUploading(true);
    try {
      const blob = await preparePhoto(file);
      const path = `catalogs/${catalogId}/${crypto.randomUUID()}.jpg`;
      const { error } = await createClient().storage.from(bucket).upload(path, blob, { contentType: "image/jpeg", upsert: false });
      if (error) throw error;
      uploads.current.push(path);
      set("imagePath", path);
      setErrors(current => { const next = { ...current }; delete next.imagePath; return next; });
    } catch {
      setErrors(current => ({ ...current, imagePath: "Fotografia nu a putut fi încărcată. Încearcă din nou." }));
    } finally {
      setUploading(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    const result = await save(() => saveProduct(catalogId, product?.id ?? null, { ...values, imagePath: values.imagePath || null }));
    setBusy(false);
    if (!result.ok) { setErrors(result.errors ?? {}); return; }
    discard(values.imagePath);
    onSaved(result.value);
  }

  return (
    <dialog ref={dialog} className="hc-dialog" onCancel={event => { event.preventDefault(); close(); }} aria-labelledby="hc-dialog-title">
      <form onSubmit={submit} noValidate>
        <header><h2 id="hc-dialog-title">{product ? "Editează produsul" : "Produs nou"}</h2>
          <button type="button" className="hc-icon" onClick={close} aria-label="Închide">×</button></header>
        <div className="hc-dialog-body">
          <div className="hc-photo">
            <span className="hc-photo-box">{values.imagePath ? <img src={imageUrl(values.imagePath)} alt="Fotografia produsului" /> : <span>Fără fotografie</span>}</span>
            <input ref={fileInput} type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={event => pickPhoto(event.target.files?.[0])} />
            <button type="button" className={`button button-outline ${uploading ? "is-busy" : ""}`} disabled={uploading} onClick={() => fileInput.current?.click()}>
              {uploading && <span className="busy-spinner" aria-hidden="true" />}{values.imagePath ? "Înlocuiește fotografia" : "Încarcă fotografia"}</button>
            {values.imagePath && <button type="button" className="button danger-outline" disabled={uploading} onClick={() => set("imagePath", "")}>Elimină fotografia</button>}
            <small>Fotografia se încadrează automat în chenar, fără să fie tăiată sau deformată.</small>
            <FieldError errors={errors} name="imagePath" />
          </div>
          <div className="hc-fields">
            <label className="hc-wide">Denumirea produsului *<input {...text("name")} maxLength={80} autoFocus /><FieldError errors={errors} name="name" /></label>
            <label>Colecția *<select {...text("collectionId")}>{collections.map(collection => <option key={collection.id} value={collection.id}>{collection.name}</option>)}</select><FieldError errors={errors} name="collectionId" /></label>
            <label>Preț *<input {...text("price")} inputMode="decimal" placeholder="ex. 6.59" /><FieldError errors={errors} name="price" /></label>
            <label>Moneda<select {...text("currency")}><option value="">Moneda catalogului ({currency})</option>{catalogCurrencies.filter(code => code !== currency).map(code => <option key={code}>{code}</option>)}</select><FieldError errors={errors} name="currency" /></label>
            <label>Volum / gramaj<input {...text("sizeValue")} inputMode="decimal" placeholder="ex. 550" /><FieldError errors={errors} name="sizeValue" /></label>
            <label>Unitate<select {...text("sizeUnit")}>{(Object.keys(sizeUnits) as SizeUnit[]).map(unit => <option key={unit} value={unit}>{sizeUnits[unit]}</option>)}</select><FieldError errors={errors} name="sizeUnit" /></label>
            <label>Cod produs (SKU)<input {...text("sku")} maxLength={40} placeholder="ex. AT03126" /><FieldError errors={errors} name="sku" /></label>
            <label className="hc-check"><input type="checkbox" checked={values.active} onChange={event => set("active", event.target.checked)} />Apare în PDF</label>
          </div>
        </div>
        <footer>
          {Object.keys(errors).length > 0 && <span className="hc-field-error">Verifică câmpurile marcate.</span>}
          <button type="button" className="button button-outline" onClick={close}>Renunță</button>
          <button type="submit" className={`button button-primary ${busy ? "is-busy" : ""}`} disabled={busy || uploading}>{busy && <span className="busy-spinner" aria-hidden="true" />}Salvează produsul</button>
        </footer>
      </form>
    </dialog>
  );
}
