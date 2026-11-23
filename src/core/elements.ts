import type { ElementSet, OmmRecord, SatcatEntry } from './types.ts';
import { headerIndex, parseCsv } from './csv.ts';

export interface ParseResult {
  records: ElementSet[];
  rejected: number;
}

const OMM_NUMERIC = [
  'MEAN_MOTION',
  'ECCENTRICITY',
  'INCLINATION',
  'RA_OF_ASC_NODE',
  'ARG_OF_PERICENTER',
  'MEAN_ANOMALY',
  'EPHEMERIS_TYPE',
  'NORAD_CAT_ID',
  'ELEMENT_SET_NO',
  'REV_AT_EPOCH',
  'BSTAR',
  'MEAN_MOTION_DOT',
  'MEAN_MOTION_DDOT',
] as const;

/** OMM EPOCH ("2026-11-23T08:14:22.123456") → UTC milisaniye. */
export function parseOmmEpoch(epoch: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?Z?$/.exec(epoch.trim());
  if (!m) return NaN;
  const frac = m[7] ? Number(`0.${m[7]}`) : 0;
  return (
    Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]), Number(m[6])) +
    frac * 1000
  );
}

/** CelesTrak GP CSV (OMM anahtar kelimeleri) → eleman kümeleri. Sütun sırasından bağımsızdır. */
export function parseGpCsv(text: string): ParseResult {
  const rows = parseCsv(text);
  if (rows.length === 0) return { records: [], rejected: 0 };
  const h = headerIndex(rows[0]!);
  for (const key of ['OBJECT_NAME', 'EPOCH', 'NORAD_CAT_ID', 'MEAN_MOTION']) {
    if (!h.has(key)) throw new Error(`Beklenmeyen GP CSV biçimi: ${key} sütunu yok`);
  }
  const get = (r: string[], k: string): string => {
    const i = h.get(k);
    return i === undefined ? '' : (r[i] ?? '').trim();
  };

  const records: ElementSet[] = [];
  let rejected = 0;
  for (let ri = 1; ri < rows.length; ri++) {
    const r = rows[ri]!;
    const nums: Record<string, number> = {};
    let ok = true;
    for (const k of OMM_NUMERIC) {
      const raw = get(r, k);
      const v = raw === '' ? 0 : Number(raw);
      if (!Number.isFinite(v)) {
        ok = false;
        break;
      }
      nums[k] = v;
    }
    const epochStr = get(r, 'EPOCH');
    const epochMs = parseOmmEpoch(epochStr);
    if (!ok || !Number.isFinite(epochMs) || !(nums.NORAD_CAT_ID! > 0) || !(nums.MEAN_MOTION! > 0)) {
      rejected++;
      continue;
    }
    const omm: OmmRecord = {
      OBJECT_NAME: get(r, 'OBJECT_NAME'),
      OBJECT_ID: get(r, 'OBJECT_ID'),
      EPOCH: epochStr,
      CLASSIFICATION_TYPE: get(r, 'CLASSIFICATION_TYPE') || 'U',
      MEAN_MOTION: nums.MEAN_MOTION!,
      ECCENTRICITY: nums.ECCENTRICITY!,
      INCLINATION: nums.INCLINATION!,
      RA_OF_ASC_NODE: nums.RA_OF_ASC_NODE!,
      ARG_OF_PERICENTER: nums.ARG_OF_PERICENTER!,
      MEAN_ANOMALY: nums.MEAN_ANOMALY!,
      EPHEMERIS_TYPE: nums.EPHEMERIS_TYPE!,
      NORAD_CAT_ID: nums.NORAD_CAT_ID!,
      ELEMENT_SET_NO: nums.ELEMENT_SET_NO!,
      REV_AT_EPOCH: nums.REV_AT_EPOCH!,
      BSTAR: nums.BSTAR!,
      MEAN_MOTION_DOT: nums.MEAN_MOTION_DOT!,
      MEAN_MOTION_DDOT: nums.MEAN_MOTION_DDOT!,
    };
    records.push({
      name: omm.OBJECT_NAME || `NORAD ${omm.NORAD_CAT_ID}`,
      norad: omm.NORAD_CAT_ID,
      intlDes: omm.OBJECT_ID,
      epochMs,
      meanMotion: omm.MEAN_MOTION,
      eccentricity: omm.ECCENTRICITY,
      inclinationDeg: omm.INCLINATION,
      src: { kind: 'omm', omm },
    });
  }
  return { records, rejected };
}

/** GP CSV içinden yalnızca NORAD numaralarını çıkarır (kategori grupları için). */
export function parseGpCsvIds(text: string): number[] {
  const rows = parseCsv(text);
  if (rows.length === 0) return [];
  const idx = headerIndex(rows[0]!).get('NORAD_CAT_ID');
  if (idx === undefined) throw new Error('Beklenmeyen GP CSV biçimi: NORAD_CAT_ID yok');
  const out: number[] = [];
  for (let i = 1; i < rows.length; i++) {
    const v = Number(rows[i]![idx]);
    if (Number.isInteger(v) && v > 0) out.push(v);
  }
  return out;
}

// ---------------------------------------------------------------- TLE (yedek kaynak)

const ALPHA5 = 'ABCDEFGHJKLMNPQRSTUVWXYZ'; // I ve O kullanılmaz; A = 10

export function parseCatalogNumber(field: string): number {
  const s = field.trim();
  if (!s) return NaN;
  const c = s.charAt(0);
  if (c >= 'A' && c <= 'Z') {
    const v = ALPHA5.indexOf(c);
    if (v < 0 || !/^\d{4}$/.test(s.slice(1))) return NaN;
    return (v + 10) * 10000 + Number(s.slice(1));
  }
  return /^\d+$/.test(s) ? Number(s) : NaN;
}

export function tleChecksum(line: string): number {
  let sum = 0;
  for (let i = 0; i < 68 && i < line.length; i++) {
    const ch = line.charCodeAt(i);
    if (ch >= 48 && ch <= 57) sum += ch - 48;
    else if (ch === 45) sum += 1;
  }
  return sum % 10;
}

export function isValidTleLine(line: string, lineNo: '1' | '2'): boolean {
  return (
    line.length >= 69 &&
    line.charAt(0) === lineNo &&
    line.charAt(1) === ' ' &&
    tleChecksum(line) === Number(line.charAt(68))
  );
}

export function parseTleEpoch(line1: string): number {
  const yy = Number(line1.slice(18, 20));
  const doy = Number(line1.slice(20, 32));
  const year = yy < 57 ? 2000 + yy : 1900 + yy;
  return Date.UTC(year, 0, 1) + (doy - 1) * 86_400_000;
}

/** "98067A" → "1998-067A" */
export function formatTleIntlDes(raw: string): string {
  const s = raw.trim();
  if (!/^\d{5}/.test(s)) return s;
  const yy = Number(s.slice(0, 2));
  return `${yy < 57 ? 2000 + yy : 1900 + yy}-${s.slice(2, 5)}${s.slice(5)}`;
}

/** 2 veya 3 satırlı TLE metnini ayrıştırır; sağlama toplamı hatalı kayıtları reddeder. */
export function parseTleText(text: string): ParseResult {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.replace(/\s+$/, ''))
    .filter((l) => l.length > 0);
  const records: ElementSet[] = [];
  let rejected = 0;
  let pendingName: string | null = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const next = lines[i + 1];
    if (line.startsWith('1 ') && next !== undefined && next.startsWith('2 ')) {
      i++;
      const name = pendingName;
      pendingName = null;
      if (!isValidTleLine(line, '1') || !isValidTleLine(next, '2')) {
        rejected++;
        continue;
      }
      const norad = parseCatalogNumber(line.slice(2, 7));
      if (!Number.isFinite(norad) || norad !== parseCatalogNumber(next.slice(2, 7))) {
        rejected++;
        continue;
      }
      const meanMotion = Number(next.slice(52, 63));
      const eccentricity = Number(`0.${next.slice(26, 33).trim()}`);
      const inclinationDeg = Number(next.slice(8, 16));
      const epochMs = parseTleEpoch(line);
      if (![meanMotion, eccentricity, inclinationDeg, epochMs].every(Number.isFinite) || meanMotion <= 0) {
        rejected++;
        continue;
      }
      records.push({
        name: name ?? `NORAD ${norad}`,
        norad,
        intlDes: formatTleIntlDes(line.slice(9, 17)),
        epochMs,
        meanMotion,
        eccentricity,
        inclinationDeg,
        src: { kind: 'tle', line1: line, line2: next },
      });
    } else {
      pendingName = line.trim().replace(/^0 /, '');
    }
  }
  return { records, rejected };
}

// ---------------------------------------------------------------- SATCAT

export type SatcatRow = [norad: number, owner: string, launch: string | null, apogee: number | null, perigee: number | null];

/** CelesTrak SATCAT CSV → yalnızca yörüngede olan (DECAY_DATE boş) nesneler. */
export function parseSatcatCsv(text: string): SatcatRow[] {
  const rows = parseCsv(text);
  if (rows.length === 0) return [];
  const h = headerIndex(rows[0]!);
  const iId = h.get('NORAD_CAT_ID');
  const iOwner = h.get('OWNER');
  if (iId === undefined || iOwner === undefined) throw new Error('Beklenmeyen SATCAT CSV biçimi');
  const iLaunch = h.get('LAUNCH_DATE');
  const iDecay = h.get('DECAY_DATE');
  const iApo = h.get('APOGEE');
  const iPeri = h.get('PERIGEE');
  const num = (v: string | undefined): number | null => {
    if (v === undefined || v.trim() === '') return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  };
  const out: SatcatRow[] = [];
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i]!;
    if (iDecay !== undefined && (r[iDecay] ?? '').trim() !== '') continue;
    const id = Number(r[iId]);
    if (!Number.isInteger(id) || id <= 0) continue;
    const owner = (r[iOwner] ?? '').trim();
    const launch = iLaunch !== undefined ? (r[iLaunch] ?? '').trim() || null : null;
    out.push([id, owner, launch, num(iApo !== undefined ? r[iApo] : undefined), num(iPeri !== undefined ? r[iPeri] : undefined)]);
  }
  return out;
}

export function satcatRowsToMap(rows: SatcatRow[]): Map<number, SatcatEntry> {
  const m = new Map<number, SatcatEntry>();
  for (const [id, owner, launchDate, apogeeKm, perigeeKm] of rows) {
    m.set(id, { owner, launchDate, apogeeKm, perigeeKm });
  }
  return m;
}
