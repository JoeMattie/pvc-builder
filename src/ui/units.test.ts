// Unit-conversion helpers (planfile §3): SI internally, conversion at the UI
// boundary only. Exact factors: 1 in = 0.0254 m, 1 lb = 0.45359237 kg.
import { describe, expect, it } from 'vitest';
import type { LengthDisplay } from '../schema';
import {
  formatLength,
  formatLengthDisplay,
  formatMass,
  KG_PER_LB,
  lengthDisplayUnit,
  lengthFromDisplay,
  lengthToDisplay,
  lengthUnit,
  M_PER_IN,
  parseLength,
} from './units';

describe('conversion factors', () => {
  it('uses the exact international definitions', () => {
    expect(M_PER_IN).toBe(0.0254);
    expect(KG_PER_LB).toBe(0.45359237);
  });
});

describe('lengthToDisplay / lengthFromDisplay', () => {
  it('round-trips a length through imperial display units', () => {
    const m = 0.9144; // exactly 36 in
    expect(lengthToDisplay(m, 'imperial')).toBeCloseTo(36, 12);
    expect(lengthFromDisplay(36, 'imperial')).toBeCloseTo(m, 12);
  });

  it('is the identity for metric', () => {
    expect(lengthToDisplay(1.25, 'metric')).toBe(1.25);
    expect(lengthFromDisplay(1.25, 'metric')).toBe(1.25);
  });
});

describe('formatLength', () => {
  it('formats metric metres like the existing panel style', () => {
    expect(formatLength(0.5, 'metric')).toBe('0.5 m');
    expect(formatLength(1.23456789, 'metric')).toBe('1.2346 m');
  });

  it('formats imperial as inches', () => {
    expect(formatLength(0.0254, 'imperial')).toBe('1 in');
    expect(formatLength(0.5, 'imperial')).toBe('19.69 in');
  });
});

describe('formatMass', () => {
  it('formats metric kilograms', () => {
    expect(formatMass(1.5, 'metric')).toBe('1.5 kg');
    expect(formatMass(0.1234567, 'metric')).toBe('0.123 kg');
  });

  it('formats imperial pounds', () => {
    expect(formatMass(0.45359237, 'imperial')).toBe('1 lb');
    expect(formatMass(1.5, 'imperial')).toBe('3.31 lb');
  });
});

describe('lengthUnit', () => {
  it('names the display unit', () => {
    expect(lengthUnit('imperial')).toBe('in');
    expect(lengthUnit('metric')).toBe('m');
  });
});

describe('formatLengthDisplay', () => {
  const cases: Array<[number, LengthDisplay | undefined, string]> = [
    // mm: 1 decimal, trailing zeros trimmed
    [0.0254, 'mm', '25.4 mm'],
    [0.001, 'mm', '1 mm'],
    [0.1, 'mm', '100 mm'],
    [0, 'mm', '0 mm'],
    // cm: 2 decimals trimmed
    [0.1, 'cm', '10 cm'],
    [0.0254, 'cm', '2.54 cm'],
    [0.015, 'cm', '1.5 cm'],
    // in: 2 decimals trimmed, double-quote suffix
    [0.254, 'in', '10"'],
    [0.0381, 'in', '1.5"'],
    [M_PER_IN, 'in', '1"'],
    // undefined defaults to inches
    [0.254, undefined, '10"'],
    [0.0381, undefined, '1.5"'],
    // in-frac: whole + reduced 1/16" fraction
    [10.5 * M_PER_IN, 'in-frac', '10 1/2"'],
    [0.75 * M_PER_IN, 'in-frac', '3/4"'],
    [12 * M_PER_IN, 'in-frac', '12"'],
    [0, 'in-frac', '0"'],
    [0.5 * M_PER_IN, 'in-frac', '1/2"'], // 8/16 reduces to 1/2
    [0.25 * M_PER_IN, 'in-frac', '1/4"'], // 4/16 reduces to 1/4
    [0.0625 * M_PER_IN, 'in-frac', '1/16"'], // smallest step, not reduced
    [3 * M_PER_IN, 'in-frac', '3"'], // whole, no fraction
    // rounds to a whole inch (11.99" -> 12")
    [11.99 * M_PER_IN, 'in-frac', '12"'],
    // rounds to nearest 1/16 (10.51" -> 10 8/16 -> 10 1/2")
    [10.51 * M_PER_IN, 'in-frac', '10 1/2"'],
    // negative
    [-10.5 * M_PER_IN, 'in-frac', '-10 1/2"'],
    [-0.75 * M_PER_IN, 'in-frac', '-3/4"'],
    [-3 * M_PER_IN, 'in-frac', '-3"'],
  ];

  it.each(cases)('formats %f in %s as %s', (m, display, expected) => {
    expect(formatLengthDisplay(m, display)).toBe(expected);
  });
});

describe('lengthDisplayUnit', () => {
  it('returns the bare suffix per display', () => {
    expect(lengthDisplayUnit('mm')).toBe('mm');
    expect(lengthDisplayUnit('cm')).toBe('cm');
    expect(lengthDisplayUnit('in')).toBe('in');
    expect(lengthDisplayUnit('in-frac')).toBe('in');
    expect(lengthDisplayUnit(undefined)).toBe('in');
  });
});

describe('parseLength', () => {
  const near = (actual: number | null, expected: number) => {
    expect(actual).not.toBeNull();
    expect(actual as number).toBeCloseTo(expected, 9);
  };

  it('parses millimetres', () => {
    near(parseLength('10mm', 'in'), 0.01);
    near(parseLength('10 mm', 'in'), 0.01);
    near(parseLength('1.5mm', 'in'), 0.0015);
  });

  it('parses centimetres', () => {
    near(parseLength('10cm', 'in'), 0.1);
    near(parseLength('10 cm', 'in'), 0.1);
  });

  it('parses inches (in and double-quote)', () => {
    near(parseLength('10"', 'in'), 0.254);
    near(parseLength('10 "', 'in'), 0.254);
    near(parseLength('10in', 'in'), 0.254);
    near(parseLength('10 in', 'in'), 0.254);
    near(parseLength('1.5in', 'in'), 0.0381);
    near(parseLength('1.5 in', 'in'), 0.0381);
  });

  it('parses feet (ft and prime)', () => {
    near(parseLength('10ft', 'in'), 10 * 12 * M_PER_IN);
    near(parseLength('10 ft', 'in'), 10 * 12 * M_PER_IN);
    near(parseLength("10'", 'in'), 10 * 12 * M_PER_IN);
  });

  it('parses fractional inches', () => {
    near(parseLength('1/2in', 'in'), 0.5 * M_PER_IN);
    near(parseLength('1/2 in', 'in'), 0.5 * M_PER_IN);
    near(parseLength('1/2"', 'in'), 0.5 * M_PER_IN);
  });

  it('parses mixed-number inches', () => {
    near(parseLength('10 1/2in', 'in'), 10.5 * M_PER_IN);
    near(parseLength('10-1/2"', 'in'), 10.5 * M_PER_IN);
    near(parseLength('10 1/2 in', 'in'), 10.5 * M_PER_IN);
  });

  it('parses metres', () => {
    near(parseLength('10m', 'in'), 10);
    near(parseLength('10 m', 'in'), 10);
  });

  it('is case-insensitive', () => {
    near(parseLength('10MM', 'in'), 0.01);
    near(parseLength('10IN', 'in'), 0.254);
    near(parseLength('10FT', 'in'), 10 * 12 * M_PER_IN);
  });

  it('interprets a bare number in the default display units', () => {
    near(parseLength('10', 'in'), 0.254);
    near(parseLength('1.5', 'in'), 1.5 * M_PER_IN);
    near(parseLength('1/2', 'in'), 0.5 * M_PER_IN);
    near(parseLength('10 1/2', 'in'), 10.5 * M_PER_IN);
    near(parseLength('10', 'in-frac'), 0.254);
    near(parseLength('10', 'mm'), 0.01);
    near(parseLength('10', 'cm'), 0.1);
    near(parseLength('10', undefined), 0.254);
  });

  it('round-trips a few values', () => {
    near(parseLength('25.4mm', 'in'), M_PER_IN);
    near(parseLength('2.54cm', 'in'), M_PER_IN);
    near(parseLength('1"', 'in'), M_PER_IN);
    near(parseLength('3/4"', 'in'), 0.75 * M_PER_IN);
  });

  it('returns null for empty or garbage input', () => {
    expect(parseLength('', 'in')).toBeNull();
    expect(parseLength('   ', 'in')).toBeNull();
    expect(parseLength('abc', 'in')).toBeNull();
    expect(parseLength('10xyz', 'in')).toBeNull();
    expect(parseLength('in', 'in')).toBeNull();
    expect(parseLength('1/0"', 'in')).toBeNull();
  });
});
