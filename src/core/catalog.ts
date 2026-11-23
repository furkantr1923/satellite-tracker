import { CATEGORY_GROUPS } from '../config.ts';
import { orbitFromElements } from './astro.ts';
import { ownerDisplay } from './countries.ts';
import { fold } from './text.ts';
import type { Category, Dataset, ElementSet, FilterState, Satellite } from './types.ts';

/** Grup üyeliklerinden NORAD → kategori haritası (öncelik sırası config'deki gibidir). */
export function buildGroupMap(memberships: Map<string, number[]>): Map<number, Category> {
  const out = new Map<number, Category>();
  for (const [cat, groups] of CATEGORY_GROUPS) {
    for (const g of groups) {
      const ids = memberships.get(g);
      if (!ids) continue;
      for (const id of ids) if (!out.has(id)) out.set(id, cat);
    }
  }
  return out;
}

/** Aynı NORAD numarası birden fazla gelirse en yeni epoch'lu kayıt tutulur. */
export function dedupeElements(list: ElementSet[]): ElementSet[] {
  const byId = new Map<number, ElementSet>();
  for (const e of list) {
    const prev = byId.get(e.norad);
    if (!prev || e.epochMs > prev.epochMs) byId.set(e.norad, e);
  }
  return [...byId.values()].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : a.norad - b.norad));
}

export function buildCatalog(ds: Dataset): Satellite[] {
  return dedupeElements(ds.elements).map((el, index) => {
    const sc = ds.satcat?.get(el.norad) ?? null;
    const owner = sc?.owner || null;
    const country = ownerDisplay(owner);
    return {
      index,
      norad: el.norad,
      name: el.name,
      intlDes: el.intlDes,
      elements: el,
      category: ds.groups?.get(el.norad) ?? 'other',
      categoryKnown: ds.groups !== null,
      orbit: orbitFromElements(el.meanMotion, el.eccentricity),
      owner,
      country,
      launchDate: sc?.launchDate ?? null,
      searchKey: fold(`${el.name} ${el.norad} ${el.intlDes} ${owner ?? ''} ${country ?? ''}`),
    };
  });
}

export function defaultFilter(all: { categories: Category[]; orbits: FilterState['orbits'] }): FilterState {
  return { query: '', categories: new Set(all.categories), orbits: new Set(all.orbits), owner: null };
}

/** Filtreyi uygular; eşleşen indeksleri ve 3D sahne için görünürlük maskesini döndürür. */
export function applyFilter(sats: Satellite[], f: FilterState): { indices: number[]; mask: Uint8Array } {
  const q = fold(f.query.trim());
  const terms = q ? q.split(/\s+/) : [];
  const mask = new Uint8Array(sats.length);
  const indices: number[] = [];
  for (const s of sats) {
    if (!f.categories.has(s.category)) continue;
    if (!f.orbits.has(s.orbit.cls)) continue;
    if (f.owner !== null && s.owner !== f.owner) continue;
    if (terms.length && !terms.every((t) => s.searchKey.includes(t))) continue;
    mask[s.index] = 1;
    indices.push(s.index);
  }
  return { indices, mask };
}

/** Ülke/sahip filtre seçenekleri — uydu sayısına göre azalan. */
export function ownerOptions(sats: Satellite[]): Array<{ code: string; label: string; count: number }> {
  const counts = new Map<string, number>();
  for (const s of sats) if (s.owner) counts.set(s.owner, (counts.get(s.owner) ?? 0) + 1);
  return [...counts.entries()]
    .map(([code, count]) => ({ code, label: ownerDisplay(code) ?? code, count }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, 'tr'));
}
