/** Uygulama genelinde kullanılan veri tipleri. */

export type Category =
  | 'station'
  | 'weather'
  | 'nav'
  | 'earth'
  | 'science'
  | 'military'
  | 'comm'
  | 'other';

export type OrbitClass = 'LEO' | 'MEO' | 'GEO' | 'HEO' | 'OTHER';

export type SourceId = 'celestrak' | 'amsat';

/** CelesTrak GP verisinin OMM (CCSDS 502.0-B-3) alanları. */
export interface OmmRecord {
  OBJECT_NAME: string;
  OBJECT_ID: string;
  EPOCH: string;
  MEAN_MOTION: number;
  ECCENTRICITY: number;
  INCLINATION: number;
  RA_OF_ASC_NODE: number;
  ARG_OF_PERICENTER: number;
  MEAN_ANOMALY: number;
  EPHEMERIS_TYPE: number;
  CLASSIFICATION_TYPE: string;
  NORAD_CAT_ID: number;
  ELEMENT_SET_NO: number;
  REV_AT_EPOCH: number;
  BSTAR: number;
  MEAN_MOTION_DOT: number;
  MEAN_MOTION_DDOT: number;
}

/** Yörünge hesaplayıcıya gönderilen ham eleman kümesi. */
export type ElementSource =
  | { kind: 'omm'; omm: OmmRecord }
  | { kind: 'tle'; line1: string; line2: string };

/** Kaynaktan gelen, ayrıştırılmış tek uydu eleman kümesi. */
export interface ElementSet {
  name: string;
  norad: number;
  intlDes: string;
  epochMs: number;
  meanMotion: number; // tur/gün
  eccentricity: number;
  inclinationDeg: number;
  src: ElementSource;
}

export interface SatcatEntry {
  owner: string;
  launchDate: string | null;
  apogeeKm: number | null;
  perigeeKm: number | null;
}

export interface OrbitInfo {
  cls: OrbitClass;
  periodMin: number;
  apogeeKm: number;
  perigeeKm: number;
}

export interface Satellite {
  index: number;
  norad: number;
  name: string;
  intlDes: string;
  elements: ElementSet;
  category: Category;
  categoryKnown: boolean;
  orbit: OrbitInfo;
  owner: string | null;
  country: string | null;
  launchDate: string | null;
  searchKey: string;
}

export interface Dataset {
  elements: ElementSet[];
  elementsFetchedAt: number;
  elementsSource: SourceId;
  groups: Map<number, Category> | null;
  groupsFetchedAt: number | null;
  satcat: Map<number, SatcatEntry> | null;
  satcatFetchedAt: number | null;
}

export type DataState = 'loading' | 'live' | 'stale' | 'offline' | 'paused' | 'empty';

export interface DataStatus {
  state: DataState;
  online: boolean;
  message: string;
  elementsFetchedAt: number | null;
  elementsSource: SourceId | null;
  /** Çevrimdışıyken konumların dondurulduğu an (ms). Çevrimiçiyken null. */
  frozenAt: number | null;
  nextRetryAt: number | null;
  lastError: string | null;
}

export interface SatDetail {
  index: number;
  latDeg: number;
  lonDeg: number;
  altKm: number;
  speedKmS: number;
}

export interface PositionFrame {
  gen: number;
  t: number;
  pos: Float32Array;
  vel: Float32Array;
  valid: Uint8Array;
  validCount: number;
  detail: SatDetail | null;
}

export interface PerfProfile {
  id: 'desktop' | 'mobile' | 'low';
  label: string;
  pixelRatioMax: number;
  antialias: boolean;
  sphereSegments: number;
  clouds: boolean;
  stars: boolean;
  maxLabels: number;
  tickMs: number;
  pointScale: number;
  pickRadiusPx: number;
}

export interface FilterState {
  query: string;
  categories: Set<Category>;
  orbits: Set<OrbitClass>;
  owner: string | null;
}
