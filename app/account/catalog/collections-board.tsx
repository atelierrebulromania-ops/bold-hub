"use client";

import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { formatDateTime } from "@/lib/orders";
import { formatMoney } from "@/lib/pricing";
import { deleteCollection, saveCollection } from "./actions";
import type { CatalogProduct, Collection } from "./catalog-table";

export function CollectionsBoard({ products, collections }: { products: CatalogProduct[]; collections: Collection[] }) {
  // null: closed; "new": a new collection; otherwise the id being edited.
  const [openId, setOpenId] = useState<string | null>(null);
  const byId = new Map(products.map((product) => [product.id, product]));
  const open = openId === "new" ? null : collections.find((collection) => collection.id === openId) ?? null;

  return (
    <>
      <div className="catalog-toolbar">
        <p>Liste de produse pe care le adaugi dintr-un click într-o ofertă sau proformă. Poți crea o colecție și din tab-ul Produse, bifând produsele.</p>
        <div className="agent-heading-actions"><button type="button" className="button button-primary" onClick={() => setOpenId("new")}>+ Colecție nouă</button></div>
      </div>
      {collections.length === 0 ? <p className="admin-empty-note">Nu ai încă nicio colecție.</p>
        : <div className="handed-table-wrap"><table className="handed-table">
          <thead><tr><th className="collection-name-col">Colecție</th><th>Produse</th><th>Valoare listă (1 buc./produs)</th><th>Modificată</th><th><span className="sr-only">Folosește</span></th></tr></thead>
          <tbody>{collections.map((collection) => {
            const items = collection.productIds.map((id) => byId.get(id)).filter((product): product is CatalogProduct => !!product);
            const value = items.reduce((sum, product) => sum + (product.list_price ?? 0), 0);
            return (
              <tr key={collection.id} className={`handed-row ${openId === collection.id ? "selected" : ""}`} onClick={() => setOpenId(collection.id)}>
                <td className="collection-name-col"><button type="button" className="row-button strong" onClick={(event) => { event.stopPropagation(); setOpenId(collection.id); }}>{collection.name}</button></td>
                <td className="nowrap">{collection.productIds.length}</td>
                <td className="nowrap">{formatMoney(value)} lei</td>
                <td className="nowrap">{formatDateTime(collection.updatedAt)}</td>
                <td className="nowrap"><span className="collection-row-actions" onClick={(event) => event.stopPropagation()}>
                  <Link className="text-button" href={`/account/offers/new?kind=offer&collection=${collection.id}`}>Ofertă</Link>
                  <Link className="text-button" href={`/account/offers/new?kind=proforma&collection=${collection.id}`}>Proformă</Link>
                </span></td>
              </tr>
            );
          })}</tbody>
        </table></div>}
      {openId && <CollectionEditor key={openId} collection={open} products={products} onClose={() => setOpenId(null)} />}
    </>
  );
}

function CollectionEditor({ collection, products, onClose }: { collection: Collection | null; products: CatalogProduct[]; onClose: () => void }) {
  const router = useRouter();
  const [name, setName] = useState(collection?.name ?? "");
  const [ids, setIds] = useState<string[]>(collection?.productIds ?? []);
  const [query, setQuery] = useState("");
  const [feedback, setFeedback] = useState<{ ok: boolean; message: string } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [pending, start] = useTransition();
  const byId = new Map(products.map((product) => [product.id, product]));
  const needle = query.trim().toLocaleLowerCase("ro");
  const matches = needle.length < 2 ? [] : products.filter((product) => !ids.includes(product.id)
    && `${product.name} ${product.sku}`.toLocaleLowerCase("ro").includes(needle)).slice(0, 8);
  const missing = ids.filter((id) => !byId.has(id)).length;

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  function save() {
    setFeedback(null);
    start(async () => {
      const result = await saveCollection(collection?.id ?? null, name, ids);
      setFeedback(result);
      if (result.ok) { router.refresh(); if (!collection) onClose(); }
    });
  }

  function remove() {
    if (!collection) return;
    start(async () => {
      const result = await deleteCollection(collection.id);
      setFeedback(result);
      if (result.ok) { router.refresh(); onClose(); }
    });
  }

  return (
    <>
      <div className="detail-backdrop" onClick={onClose} aria-hidden="true" />
      <aside className="detail-panel" aria-label={collection ? `Colecția ${collection.name}` : "Colecție nouă"}>
        <div className="detail-header"><div><p className="eyebrow">{collection ? "Colecție" : "Colecție nouă"}</p><h2>{name.trim() || "Fără nume"}</h2></div>
          <button className="close-button" aria-label="Închide" onClick={onClose}>×</button></div>
        <div className="detail-scroll">
          <section className="detail-section"><h3>Nume</h3>
            <input className="collection-name" value={name} maxLength={120} onChange={(event) => setName(event.target.value)} placeholder="ex. Săpunuri lichide HoReCa" autoFocus={!collection} />
          </section>
          <section className="detail-section"><div className="section-line"><h3>Produse</h3><span>{ids.length}</span></div>
            <div className="product-picker">
              <input className="group-member-search" type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Adaugă produs (nume sau SKU)" aria-label="Adaugă produs" />
              {matches.length > 0 && <div className="group-member-list request-options">{matches.map((product) => (
                <button key={product.id} type="button" className="request-option" onClick={() => { setIds([...ids, product.id]); setQuery(""); }}>
                  <span>{product.name}</span><small>SKU {product.sku} · {formatMoney(product.list_price ?? 0)} lei</small>
                </button>
              ))}</div>}
            </div>
            {ids.length === 0 ? <p className="muted small">Colecția nu are încă produse.</p>
              : <div className="item-list">{ids.map((id) => {
                const product = byId.get(id);
                if (!product) return null;
                return <div className="order-item" key={id}><div><strong>{product.name}</strong><small>SKU {product.sku}{product.category ? ` · ${product.category}` : ""} · {formatMoney(product.list_price ?? 0)} lei</small></div>
                  <button type="button" className="remove-button" title="Scoate" aria-label={`Scoate ${product.name}`} onClick={() => setIds(ids.filter((item) => item !== id))}><svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M7 7l10 10M17 7 7 17" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"/></svg></button></div>;
              })}</div>}
            {missing > 0 && <p className="muted small">{missing} {missing === 1 ? "produs nu mai are" : "produse nu mai au"} preț în BOCP și nu apar în oferte.</p>}
          </section>
          {collection && <section className="detail-section"><h3>Folosește colecția</h3>
            <div className="collection-uses">
              <Link className="button button-outline" href={`/account/offers/new?kind=offer&collection=${collection.id}`}>Ofertă nouă din colecție</Link>
              <Link className="button button-outline" href={`/account/offers/new?kind=proforma&collection=${collection.id}`}>Proformă nouă din colecție</Link>
            </div>
          </section>}
          {feedback && <p className={`action-feedback ${feedback.ok ? "success" : "error"}`} role="status" aria-live="polite">{feedback.message}</p>}
        </div>
        <div className="detail-actions">
          {collection && (confirmDelete
            ? <div className="collection-delete"><span>Ștergi colecția? Ofertele făcute deja rămân.</span>
              <button type="button" className="text-button" onClick={() => setConfirmDelete(false)}>Nu</button>
              <button type="button" className="button button-danger" disabled={pending} onClick={remove}>Da, șterge</button></div>
            : <button type="button" className="text-button danger-text" onClick={() => setConfirmDelete(true)}>Șterge colecția</button>)}
          <button type="button" className="button button-primary" disabled={pending || !name.trim()} onClick={save}>{collection ? "Salvează" : "Creează colecția"}</button>
        </div>
      </aside>
    </>
  );
}
