import type { Category, OrbitClass, PerfProfile } from './core/types.ts';

export const APP = {
  name: 'SATELLITE TRACKER',
  version: '1.0.0',
  developer: 'Furkan',
} as const;

/** WGS-72 ekvator yarıçapı (SGP4 ile tutarlı), km. */
export const EARTH_RADIUS_KM = 6378.135;
/** Yerçekimi parametresi (WGS-72), km³/s². */
export const MU_KM3_S2 = 398600.8;

const CT = 'https://celestrak.org';

export const ENDPOINTS = {
  /** Aktif uyduların GP (OMM) verisi — CSV, 6 haneli katalog numaralarını destekler. */
  active: `${CT}/NORAD/elements/gp.php?GROUP=active&FORMAT=csv`,
  group: (g: string) => `${CT}/NORAD/elements/gp.php?GROUP=${encodeURIComponent(g)}&FORMAT=csv`,
  satcat: `${CT}/pub/satcat.csv`,
  /** Yedek: AMSAT amatör uydu TLE listesi (yalnızca CelesTrak hiç erişilemezse ve önbellek yoksa). */
  amsat: 'https://www.amsat.org/tle/current/nasabare.txt',
} as const;

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

export const REFRESH = {
  /** Uygulamanın veri durumunu kontrol ettiği aralık (istek atmaz, yalnızca kontrol eder). */
  checkIntervalMs: 30_000,
  /** CelesTrak GP verisi yaklaşık 2 saatte bir güncellenir; daha sık indirmiyoruz. */
  elementsMaxAgeMs: 2 * HOUR,
  groupsMaxAgeMs: 7 * DAY,
  satcatMaxAgeMs: 7 * DAY,
  /** Bu yaştan eski eleman verisi "eski" olarak işaretlenir. */
  staleAfterMs: 6 * HOUR,
  retryBaseMs: 30_000,
  retryMaxMs: 10 * MIN,
  requestTimeoutMs: 60_000,
  interRequestDelayMs: 1500,
} as const;

export interface CategoryMeta {
  id: Category;
  label: string;
  color: string;
}

export const CATEGORIES: CategoryMeta[] = [
  { id: 'comm', label: 'Haberleşme', color: '#4FA3FF' },
  { id: 'earth', label: 'Yer Gözlemi', color: '#3DDC97' },
  { id: 'weather', label: 'Meteoroloji', color: '#FFD166' },
  { id: 'nav', label: 'Navigasyon', color: '#C792EA' },
  { id: 'science', label: 'Bilimsel', color: '#5EEAD4' },
  { id: 'station', label: 'Uzay İstasyonu', color: '#FFFFFF' },
  { id: 'military', label: 'Askerî', color: '#FF9E6B' },
  { id: 'other', label: 'Diğer', color: '#8A9BB8' },
];

export const CATEGORY_BY_ID = new Map(CATEGORIES.map((c) => [c.id, c]));

/**
 * CelesTrak GP grupları → uygulama kategorisi.
 * Sıra önceliktir: bir uydu birden çok grupta ise listede önce gelen kategori kazanır.
 */
export const CATEGORY_GROUPS: Array<[Exclude<Category, 'other'>, string[]]> = [
  ['station', ['stations']],
  ['weather', ['weather']],
  ['nav', ['gnss', 'sbas']],
  ['earth', ['resource', 'planet', 'spire', 'dmc', 'argos']],
  ['science', ['science', 'geodetic', 'engineering', 'education']],
  ['military', ['military']],
  [
    'comm',
    [
      'starlink',
      'oneweb',
      'iridium-NEXT',
      'intelsat',
      'ses',
      'globalstar',
      'orbcomm',
      'tdrss',
      'amateur',
      'x-comm',
      'other-comm',
    ],
  ],
];

export const ORBIT_CLASSES: Array<{ id: OrbitClass; label: string; hint: string }> = [
  { id: 'LEO', label: 'LEO', hint: 'Alçak Dünya yörüngesi (< 2.000 km)' },
  { id: 'MEO', label: 'MEO', hint: 'Orta Dünya yörüngesi' },
  { id: 'GEO', label: 'GEO', hint: 'Yer eşzamanlı yörünge (~35.786 km)' },
  { id: 'HEO', label: 'HEO', hint: 'Yüksek eliptik yörünge (e ≥ 0,25)' },
  { id: 'OTHER', label: 'Diğer', hint: 'Yukarıdakilere uymayan yörüngeler' },
];

export const PROFILES: Record<PerfProfile['id'], PerfProfile> = {
  desktop: {
    id: 'desktop',
    label: 'Masaüstü (yüksek)',
    pixelRatioMax: 2,
    antialias: true,
    sphereSegments: 128,
    clouds: true,
    stars: true,
    maxLabels: 40,
    tickMs: 1000,
    pointScale: 1,
    pickRadiusPx: 14,
  },
  mobile: {
    id: 'mobile',
    label: 'Mobil (dengeli)',
    pixelRatioMax: 1.75,
    antialias: false,
    sphereSegments: 72,
    clouds: false,
    stars: true,
    maxLabels: 14,
    tickMs: 2000,
    pointScale: 1.35,
    pickRadiusPx: 24,
  },
  low: {
    id: 'low',
    label: 'Düşük (tasarruf)',
    pixelRatioMax: 1,
    antialias: false,
    sphereSegments: 48,
    clouds: false,
    stars: false,
    maxLabels: 8,
    tickMs: 3000,
    pointScale: 1.25,
    pickRadiusPx: 22,
  },
};
