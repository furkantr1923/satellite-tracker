/** Arama için harf katlama: Türkçe I/İ/ı ve aksanlar normalize edilir. */
export function fold(s: string): string {
  return s
    .replace(/[İIı]/g, 'i')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');
}

const intFmt = new Intl.NumberFormat('tr-TR');
const dec1 = new Intl.NumberFormat('tr-TR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const dec2 = new Intl.NumberFormat('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export const fmtInt = (n: number): string => intFmt.format(Math.round(n));
export const fmt1 = (n: number): string => dec1.format(n);
export const fmt2 = (n: number): string => dec2.format(n);

export function fmtAgo(ms: number, now: number): string {
  const s = Math.max(0, Math.round((now - ms) / 1000));
  if (s < 60) return 'az önce';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} dk önce`;
  const h = Math.floor(m / 60);
  if (h < 48) return m % 60 ? `${h} sa ${m % 60} dk önce` : `${h} sa önce`;
  return `${Math.floor(h / 24)} gün önce`;
}

export function fmtDateTime(ms: number): string {
  return new Date(ms).toLocaleString('tr-TR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function fmtUtcClock(ms: number): string {
  return `${new Date(ms).toISOString().slice(11, 19)} UTC`;
}

export function fmtLat(lat: number): string {
  return `${fmt2(Math.abs(lat))}° ${lat >= 0 ? 'K' : 'G'}`;
}

export function fmtLon(lon: number): string {
  return `${fmt2(Math.abs(lon))}° ${lon >= 0 ? 'D' : 'B'}`;
}

/** "2026-01-15" → "15.01.2026" */
export function fmtIsoDate(d: string | null): string | null {
  if (!d) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(d);
  return m ? `${m[3]}.${m[2]}.${m[1]}` : d;
}

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}
