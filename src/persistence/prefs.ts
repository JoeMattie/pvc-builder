import type { UnitsPreference } from '../schema';

// localStorage is for UI preferences only (planfile §3); documents live in
// Dexie.

const UNITS_KEY = 'pvc-builder.units';
const LAST_PROJECT_KEY = 'pvc-builder.lastProjectId';
const NIGHT_KEY = 'pvc-builder.night';

export function getUnitsPref(): UnitsPreference {
  const v = localStorage.getItem(UNITS_KEY);
  return v === 'metric' ? 'metric' : 'imperial';
}

export function setUnitsPref(units: UnitsPreference): void {
  localStorage.setItem(UNITS_KEY, units);
}

// The night pref is read at store-module load, which tests reach without a
// working localStorage, so it goes through a guarded accessor with an
// in-memory fallback instead of the bare global the other prefs use.
const memoryFallback = new Map<string, string>();
function safeStorage(): Storage | Map<string, string> {
  try {
    if (typeof window !== 'undefined' && window.localStorage) return window.localStorage;
  } catch {
    // security errors (opaque origin) fall through to the in-memory store
  }
  return memoryFallback;
}

export function getNightPref(): boolean {
  const s = safeStorage();
  return (s instanceof Map ? (s.get(NIGHT_KEY) ?? null) : s.getItem(NIGHT_KEY)) === '1';
}

export function setNightPref(night: boolean): void {
  const s = safeStorage();
  if (s instanceof Map) {
    if (night) s.set(NIGHT_KEY, '1');
    else s.delete(NIGHT_KEY);
  } else {
    if (night) s.setItem(NIGHT_KEY, '1');
    else s.removeItem(NIGHT_KEY);
  }
}

// Snap settings are a workspace preference (like night), read at editor-store
// load, so they use the guarded accessor with an in-memory fallback.
const SNAP_KEY = 'pvc-builder.snap';

export interface SnapPref {
  gridStepM: number;
  /** legacy combined flag (read for migration; no longer written) */
  snapToPoints?: boolean;
  snapToEnds: boolean;
  snapToPipes: boolean;
  axisInference: boolean;
}

export function getSnapPref(): Partial<SnapPref> | null {
  const s = safeStorage();
  const raw = s instanceof Map ? (s.get(SNAP_KEY) ?? null) : s.getItem(SNAP_KEY);
  if (!raw) return null;
  try {
    const p = JSON.parse(raw) as Partial<SnapPref>;
    return {
      gridStepM: typeof p.gridStepM === 'number' && p.gridStepM >= 0 ? p.gridStepM : undefined,
      snapToPoints: typeof p.snapToPoints === 'boolean' ? p.snapToPoints : undefined,
      snapToEnds: typeof p.snapToEnds === 'boolean' ? p.snapToEnds : undefined,
      snapToPipes: typeof p.snapToPipes === 'boolean' ? p.snapToPipes : undefined,
      axisInference: typeof p.axisInference === 'boolean' ? p.axisInference : undefined,
    };
  } catch {
    return null;
  }
}

export function setSnapPref(pref: {
  gridStepM: number;
  snapToEnds: boolean;
  snapToPipes: boolean;
  axisInference: boolean;
}): void {
  const s = safeStorage();
  const raw = JSON.stringify(pref);
  if (s instanceof Map) s.set(SNAP_KEY, raw);
  else s.setItem(SNAP_KEY, raw);
}

export function getLastProjectId(): string | null {
  return localStorage.getItem(LAST_PROJECT_KEY);
}

export function setLastProjectId(id: string | null): void {
  if (id === null) localStorage.removeItem(LAST_PROJECT_KEY);
  else localStorage.setItem(LAST_PROJECT_KEY, id);
}
