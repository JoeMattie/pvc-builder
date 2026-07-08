// Length/mass unit conversion at the UI display boundary (planfile §3): all
// stored quantities are SI; the design's unitsPreference only changes what the
// user sees and types.
import type { LengthDisplay, UnitsPreference } from '../schema';

/** 1 inch in metres (exact, international yard and pound agreement). */
export const M_PER_IN = 0.0254;
/** 1 avoirdupois pound in kilograms (exact). */
export const KG_PER_LB = 0.45359237;

export const lengthUnit = (units: UnitsPreference): string => (units === 'imperial' ? 'in' : 'm');

/** SI metres → the number the user sees/edits (inches when imperial). */
export const lengthToDisplay = (m: number, units: UnitsPreference): number =>
  units === 'imperial' ? m / M_PER_IN : m;

/** The number the user typed → SI metres. */
export const lengthFromDisplay = (v: number, units: UnitsPreference): number =>
  units === 'imperial' ? v * M_PER_IN : v;

export const massUnit = (units: UnitsPreference): string => (units === 'imperial' ? 'lb' : 'kg');

/** SI kilograms → the number the user sees/edits (pounds when imperial). */
export const massToDisplay = (kg: number, units: UnitsPreference): number =>
  units === 'imperial' ? kg / KG_PER_LB : kg;

/** The number the user typed → SI kilograms. */
export const massFromDisplay = (v: number, units: UnitsPreference): number =>
  units === 'imperial' ? v * KG_PER_LB : v;

const trim = (v: number, dp: number): string => String(Number(v.toFixed(dp)));

export function formatLength(m: number, units: UnitsPreference): string {
  return units === 'imperial' ? `${trim(m / M_PER_IN, 2)} in` : `${trim(m, 4)} m`;
}

export function formatMass(kg: number, units: UnitsPreference): string {
  return units === 'imperial' ? `${trim(kg / KG_PER_LB, 2)} lb` : `${trim(kg, 3)} kg`;
}

// --- LengthDisplay (schema v6) formatting/parsing --------------------------
// A LengthDisplay picks how a stored SI length is shown in the UI and how a
// bare (unitless) typed number is interpreted. Everything below is display-only;
// storage stays in SI metres.

/** 1 foot in inches (exact). */
const IN_PER_FT = 12;

const greatestCommonDivisor = (a: number, b: number): number => {
  let x = Math.abs(a);
  let y = Math.abs(b);
  while (y) {
    [x, y] = [y, x % y];
  }
  return x;
};

/** SI metres → an inches string using whole + reduced 1/16" fraction (e.g. `10 1/2"`). */
function formatInchFraction(m: number): string {
  const inches = m / M_PER_IN;
  const sign = inches < 0 ? '-' : '';
  // Round to the nearest 1/16".
  const sixteenths = Math.round(Math.abs(inches) * 16);
  const whole = Math.floor(sixteenths / 16);
  let num = sixteenths % 16;
  let den = 16;
  if (num === 0) {
    return `${sign}${whole}"`;
  }
  const g = greatestCommonDivisor(num, den);
  num /= g;
  den /= g;
  const wholePart = whole > 0 ? `${whole} ` : '';
  return `${sign}${wholePart}${num}/${den}"`;
}

/** The bare unit label for a LengthDisplay, for use beside an input field. */
export function lengthDisplayUnit(display: LengthDisplay | undefined): string {
  switch (display) {
    case 'mm':
      return 'mm';
    case 'cm':
      return 'cm';
    default:
      return 'in';
  }
}

/** SI metres → a display string in the given LengthDisplay (undefined ⇒ `'in'`). */
export function formatLengthDisplay(m: number, display: LengthDisplay | undefined): string {
  switch (display) {
    case 'mm':
      return `${trim(m * 1000, 1)} mm`;
    case 'cm':
      return `${trim(m * 100, 2)} cm`;
    case 'in-frac':
      return formatInchFraction(m);
    default:
      return `${trim(m / M_PER_IN, 2)}"`;
  }
}

/** Parse a whole, decimal, fraction (`1/2`), or mixed (`10 1/2`, `10-1/2`) magnitude. */
function parseMagnitude(token: string): number | null {
  const mixed = token.match(/^(\d+)[\s-]+(\d+)\s*\/\s*(\d+)$/);
  if (mixed) {
    const den = Number(mixed[3]);
    if (den === 0) return null;
    return Number(mixed[1]) + Number(mixed[2]) / den;
  }
  const frac = token.match(/^(\d+)\s*\/\s*(\d+)$/);
  if (frac) {
    const den = Number(frac[2]);
    if (den === 0) return null;
    return Number(frac[1]) / den;
  }
  if (/^\d*\.?\d+$/.test(token)) {
    return Number(token);
  }
  return null;
}

/** Metres-per-unit for a bare number, given the default LengthDisplay. */
function defaultUnitMetres(display: LengthDisplay | undefined): number {
  switch (display) {
    case 'mm':
      return 0.001;
    case 'cm':
      return 0.01;
    default:
      return M_PER_IN;
  }
}

/**
 * Parse a user-typed length (e.g. `10mm`, `1/2"`, `10-1/2in`, `10ft`, `10m`) into
 * SI metres, or `null` if it can't be parsed. A bare number with no unit is read
 * in `defaultDisplay` units. Case-insensitive and tolerant of internal spaces.
 */
export function parseLength(
  input: string,
  defaultDisplay: LengthDisplay | undefined,
): number | null {
  const s = input.trim().toLowerCase();
  if (!s) return null;
  const unitMatch = s.match(/(mm|cm|m|in|ft|"|')\s*$/);
  const unit = unitMatch ? unitMatch[1] : null;
  const token = (unitMatch ? s.slice(0, s.length - unitMatch[0].length) : s).trim();
  const value = parseMagnitude(token);
  if (value === null) return null;
  switch (unit) {
    case 'mm':
      return value * 0.001;
    case 'cm':
      return value * 0.01;
    case 'm':
      return value;
    case 'in':
    case '"':
      return value * M_PER_IN;
    case 'ft':
    case "'":
      return value * IN_PER_FT * M_PER_IN;
    default:
      return value * defaultUnitMetres(defaultDisplay);
  }
}
