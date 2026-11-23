import { PROFILES } from '../config.ts';
import type { PerfProfile } from './types.ts';

export type PlatformId = 'windows' | 'android' | 'web';

export function detectPlatform(): PlatformId {
  const g = globalThis as unknown as {
    __TAURI__?: unknown;
    __TAURI_INTERNALS__?: unknown;
    Capacitor?: { isNativePlatform?: () => boolean; getPlatform?: () => string };
  };
  if (g.__TAURI__ || g.__TAURI_INTERNALS__) return 'windows';
  if (g.Capacitor?.isNativePlatform?.() && g.Capacitor.getPlatform?.() === 'android') return 'android';
  return 'web';
}

/** Windows ve Android için ayrı performans profilleri; zayıf donanımda otomatik "düşük". */
export function detectProfile(platform: PlatformId): PerfProfile {
  const nav = navigator as Navigator & { deviceMemory?: number };
  const cores = nav.hardwareConcurrency || 4;
  const mem = nav.deviceMemory ?? 8;
  const mobileUa = /Android|iPhone|iPad|Mobile/i.test(nav.userAgent);
  const forced = new URLSearchParams(location.search).get('profil');
  if (forced === 'desktop' || forced === 'mobile' || forced === 'low') return PROFILES[forced];

  if (platform === 'android' || (platform === 'web' && mobileUa)) {
    return cores <= 4 || mem <= 3 ? PROFILES.low : PROFILES.mobile;
  }
  return cores <= 2 || mem <= 2 ? PROFILES.low : PROFILES.desktop;
}
