// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import {
  clampFloatingPos,
  constrainFloatingSize,
  type FloatingRect,
  resetFloatingLayout,
  snapFloatingPos,
} from './FloatingIsland';

const rect = (left: number, top: number, width: number, height: number): FloatingRect => ({
  left,
  top,
  width,
  height,
  right: left + width,
  bottom: top + height,
});

describe('floating island positioning helpers', () => {
  it('clamps panels inside the viewport margin', () => {
    expect(
      clampFloatingPos({ x: -20, y: 500 }, { width: 100, height: 80 }, { width: 400, height: 300 }),
    ).toEqual({ x: 16, y: 204 });
  });

  it('magnetically snaps adjacent panel edges while dragging', () => {
    const snapped = snapFloatingPos(
      { x: 88, y: 22 },
      { width: 100, height: 60 },
      [rect(200, 20, 120, 100)],
      { width: 600, height: 400 },
    );
    expect(snapped.x).toBe(90); // other.left - width - 10px gap
    expect(snapped.y).toBe(20);
  });

  it('constrains resize by the panel position at the right edge', () => {
    const size = constrainFloatingSize(
      { width: 240, height: 160 },
      { x: 350, y: 40 },
      { width: 80, height: 80 },
      { width: 500, height: 500 },
      { width: 500, height: 300 },
      { width: 8 },
    );
    expect(size.width).toBe(126);
    expect(size.height).toBe(160);
  });

  it('reset clears saved position, size, and collapse keys', () => {
    const values = new Map<string, string>();
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      value: {
        get length() {
          return values.size;
        },
        getItem: (key: string) => values.get(key) ?? null,
        key: (index: number) => [...values.keys()][index] ?? null,
        removeItem: (key: string) => values.delete(key),
        setItem: (key: string, value: string) => values.set(key, value),
      },
    });
    window.localStorage.setItem('pvc:floating-island:test', '{}');
    window.localStorage.setItem('pvc:floating-island-size:test', '{}');
    window.localStorage.setItem('pvc:floating-island-collapsed:test', '1');
    resetFloatingLayout();
    expect(window.localStorage.getItem('pvc:floating-island:test')).toBeNull();
    expect(window.localStorage.getItem('pvc:floating-island-size:test')).toBeNull();
    expect(window.localStorage.getItem('pvc:floating-island-collapsed:test')).toBeNull();
  });
});
