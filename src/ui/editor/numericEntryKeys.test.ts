import { describe, expect, it } from 'vitest';
import { classifyNumericEntryKey, type NumericEntryKeyInput } from './numericEntryKeys';

const key = (k: string, mods: Partial<NumericEntryKeyInput> = {}): NumericEntryKeyInput => ({
  key: k,
  ctrlKey: false,
  metaKey: false,
  altKey: false,
  ...mods,
});

describe('classifyNumericEntryKey (numeric scene entry allow-list)', () => {
  it('accepts digits, dot, dash, slash, feet/inch marks as value characters', () => {
    for (const c of ['0', '5', '9', '.', '-', '/', "'", '"']) {
      expect(classifyNumericEntryKey(key(c))).toBe('insert');
    }
  });

  it('accepts m (and M) as the ONLY letter — the mm/m unit', () => {
    expect(classifyNumericEntryKey(key('m'))).toBe('insert');
    expect(classifyNumericEntryKey(key('M'))).toBe('insert');
  });

  it('routes every other letter to the hotkey layer (V, D, upper and lower)', () => {
    for (const c of ['v', 'V', 'd', 'D', 'c', 'q', 'w', 'g', 'i', 'n', 'f', 'z']) {
      expect(classifyNumericEntryKey(key(c))).toBe('hotkey');
    }
  });

  it('routes Space to the hotkey layer', () => {
    expect(classifyNumericEntryKey(key(' '))).toBe('hotkey');
  });

  it('keeps editing/navigation keys inside the entry', () => {
    for (const k of [
      'Backspace',
      'Delete',
      'ArrowLeft',
      'ArrowRight',
      'ArrowUp',
      'ArrowDown',
      'Home',
      'End',
      'Tab',
    ]) {
      expect(classifyNumericEntryKey(key(k))).toBe('edit');
    }
  });

  it('maps Enter to commit and Escape to cancel', () => {
    expect(classifyNumericEntryKey(key('Enter'))).toBe('commit');
    expect(classifyNumericEntryKey(key('Escape'))).toBe('cancel');
  });

  it('passes modifier combos through untouched (Ctrl+Z, Cmd+V, Alt+D, even Ctrl+M)', () => {
    expect(classifyNumericEntryKey(key('z', { ctrlKey: true }))).toBe('pass');
    expect(classifyNumericEntryKey(key('v', { metaKey: true }))).toBe('pass');
    expect(classifyNumericEntryKey(key('d', { altKey: true }))).toBe('pass');
    expect(classifyNumericEntryKey(key('m', { ctrlKey: true }))).toBe('pass');
    expect(classifyNumericEntryKey(key(' ', { ctrlKey: true }))).toBe('pass');
  });

  it('shifted value characters still insert (double-quote arrives with Shift held)', () => {
    // Shift is not a pass-through modifier: `"` needs it.
    expect(classifyNumericEntryKey(key('"'))).toBe('insert');
  });

  it('consumes unlisted punctuation without firing hotkeys', () => {
    for (const c of [',', ';', '=', '(', '#', '`']) {
      expect(classifyNumericEntryKey(key(c))).toBe('ignore');
    }
  });

  it('ignores non-printable keys it does not know (F-keys, bare Shift)', () => {
    expect(classifyNumericEntryKey(key('F5'))).toBe('pass');
    expect(classifyNumericEntryKey(key('Shift'))).toBe('pass');
  });
});
