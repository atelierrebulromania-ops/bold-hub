"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { discountFor, formatMoney, type DiscountRule } from "@/lib/pricing";
import { saveCollection } from "./actions";

export type CatalogProduct = {
  id: string; name: string; sku: string; category: string | null; image_url: string | null; delisted: boolean;
  list_price: number | null; list_price_with_vat: number | null; vat_percent: number | null;
  warehouse_stock: { quantity_bocp_global: number } | null;
};
export type CatalogClient = { id: string; business_name: string; partner_discounts: DiscountRule[] };
export type Collection = { id: string; name: string; updatedAt: string; productIds: string[] };

export function CatalogTable({ products, clients, collections }: { products: CatalogProduct[]; clients: CatalogClient[]; collections: Collection[] }) {
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("");
  const [clientId, setClientId] = useState("");
  const [hideEmpty, setHideEmpty] = useState(false);
  // Products ticked to go into a collection.
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [newName, setNewName] = useState("");
  const [targetId, setTargetId] = useState("");
  const [feedback, setFeedback] = useState<{ ok: boolean; message: string } | null>(null);
  const [pending, start] = useTransition();
  const categories = useMemo(() => [...new Set(products.map((product) => product.category).filter((value): value is string => !!value))].sort((a, b) => a.localeCompare(b, "ro")), [products]);
  const client = clients.find((item) => item.id === clientId) ?? null;
  const needle = search.trim().toLocaleLowerCase("ro");
  const rows = products.filter((product) => (!category || product.category === category)
    && (!hideEmpty || (product.warehouse_stock?.quantity_bocp_global ?? 0) > 0)
    && (!needle || `${product.name} ${product.sku}`.toLocaleLowerCase("ro").includes(needle)));
  const allShown = rows.length > 0 && rows.every((product) => selected.has(product.id));

  const toggle = (id: string) => setSelected((current) => {
    const next = new Set(current);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  const toggleShown = () => setSelected((current) => {
    const next = new Set(current);
    for (const product of rows) { if (allShown) next.delete(product.id); else next.add(product.id); }
    return next;
  });

  function save(target: Collection | null) {
    const ids = [...selected];
    const name = target ? target.name : newName;
    const productIds = target ? [...target.productIds, ...ids.filter((id) => !target.productIds.includes(id))] : ids;
    setFeedback(null);
    start(async () => {
      const result = await saveCollection(target?.id ?? null, name, productIds);
      setFeedback(result.ok ? { ok: true, message: target ? `${ids.length} ${ids.length === 1 ? "produs adăugat" : "produse adăugate"} în „${target.name}”.` : result.message } : result);
      if (result.ok) { setSelected(new Set()); setNewName(""); setTargetId(""); router.refresh(); }
    });
  }

  return (
    <>
      <div className="filter-bar">
        <label className="filter-field filter-search">
          <span>Caută</span>
          <span className="search-input">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><circle cx="11" cy="11" r="6.5"/><path d="m20 20-4.2-4.2"/></svg>
            <input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Nume produs sau SKU" />
          </span>
        </label>
        <label className="filter-field">
          <span>Categorie</span>
          <select value={category} onChange={(event) => setCategory(event.target.value)}>
            <option value="">Toate categoriile</option>{categories.map((item) => <option key={item} value={item}>{item}</option>)}</select>
        </label>
        <label className="filter-field">
          <span>Prețuri pentru</span>
          <select value={clientId} onChange={(event) => setClientId(event.target.value)}>
            <option value="">Preț de listă (toți)</option>{clients.map((item) => <option key={item.id} value={item.id}>{item.business_name}</option>)}</select>
        </label>
        <label className={`filter-toggle ${hideEmpty ? "on" : ""}`}>
          <input type="checkbox" checked={hideEmpty} onChange={(event) => setHideEmpty(event.target.checked)} />
          <span className="toggle-track" aria-hidden="true"><span /></span>
          Ascunde stoc 0
        </label>
      </div>
      <p className="filter-count">{rows.length === products.length ? `${products.length} produse cu preț în BOCP` : `${rows.length} din ${products.length} produse`}</p>

      {selected.size > 0 && <div className="selection-bar" role="region" aria-label="Produse selectate">
        <strong>{selected.size} {selected.size === 1 ? "produs selectat" : "produse selectate"}</strong>
        <form className="selection-group" onSubmit={(event) => { event.preventDefault(); if (newName.trim()) save(null); }}>
          <input value={newName} maxLength={120} onChange={(event) => setNewName(event.target.value)} placeholder="Numele colecției noi" aria-label="Numele colecției noi" />
          <button type="submit" className="button button-primary" disabled={pending || !newName.trim()}>Creează colecție</button>
        </form>
        {collections.length > 0 && <div className="selection-group">
          <select className="catalog-select" value={targetId} onChange={(event) => setTargetId(event.target.value)} aria-label="Colecție existentă">
            <option value="">Alege colecția…</option>{collections.map((collection) => <option key={collection.id} value={collection.id}>{collection.name}</option>)}</select>
          <button type="button" className="button button-outline" disabled={pending || !targetId} onClick={() => save(collections.find((collection) => collection.id === targetId) ?? null)}>Adaugă în colecție</button>
        </div>}
        <button type="button" className="text-button" onClick={() => setSelected(new Set())}>Deselectează</button>
      </div>}
      {feedback && <p className={`action-feedback ${feedback.ok ? "success" : "error"} catalog-feedback`} role="status">{feedback.message}</p>}

      <div className="handed-table-wrap"><table className="handed-table catalog-table">
        <thead><tr>
          <th className="check-cell"><input type="checkbox" checked={allShown} onChange={toggleShown} aria-label="Selectează produsele afișate" /></th>
          <th><span className="sr-only">Poză</span></th><th>Produs</th><th>SKU</th><th>Categorie</th><th>Preț listă (fără TVA)</th><th>Cu TVA</th>{client && <th>Discount</th>}{client && <th>Preț client (fără TVA)</th>}<th>Stoc BOCP</th>
        </tr></thead>
        <tbody>{rows.map((product) => {
          const discount = client ? discountFor(client.partner_discounts, product.category) : 0;
          const price = product.list_price ?? 0;
          return (
            <tr key={product.id} className={selected.has(product.id) ? "selected" : ""} onClick={() => toggle(product.id)}>
              <td className="check-cell"><input type="checkbox" checked={selected.has(product.id)} onChange={() => toggle(product.id)} onClick={(event) => event.stopPropagation()} aria-label={`Selectează ${product.name}`} /></td>
              <td className="thumb-cell">{product.image_url
                // eslint-disable-next-line @next/next/no-img-element
                ? <img className="product-thumb" src={product.image_url} alt="" loading="lazy" />
                : <span className="product-thumb empty" aria-hidden="true" />}</td>
              <td className="strong">{product.name}{product.delisted && <span className="delisted-chip" title="Marcat „delistat” în BOCP: nu mai vine de la furnizor">Delistat</span>}</td>
              <td className="nowrap">{product.sku}</td>
              <td>{product.category ?? "—"}</td>
              <td className="nowrap">{formatMoney(price)} lei</td>
              <td className="nowrap">{formatMoney(product.list_price_with_vat ?? 0)} lei</td>
              {client && <td className="nowrap">{discount ? `−${discount}%` : "—"}</td>}
              {client && <td className="nowrap strong">{formatMoney(price * (1 - discount / 100))} lei</td>}
              <td className="nowrap">{product.warehouse_stock?.quantity_bocp_global ?? "—"}</td>
            </tr>
          );
        })}</tbody>
      </table></div>
    </>
  );
}
