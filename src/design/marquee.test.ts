import { describe, expect, it } from 'vitest';
import { type Pt, marqueeFromDrag, memberSelectedBy, segmentsIntersect } from './marquee';

const P = (x: number, y: number): Pt => ({ x, y });

describe('marqueeFromDrag', () => {
  it('left→right is a window (contained), right→left is crossing', () => {
    expect(marqueeFromDrag(10, 10, 100, 80).mode).toBe('window');
    expect(marqueeFromDrag(100, 10, 10, 80).mode).toBe('crossing');
  });
  it('normalises the rect corners regardless of drag direction', () => {
    expect(marqueeFromDrag(100, 80, 10, 10).rect).toEqual({
      minX: 10,
      minY: 10,
      maxX: 100,
      maxY: 80,
    });
  });
});

describe('segmentsIntersect', () => {
  it('detects a proper crossing', () => {
    expect(segmentsIntersect(P(0, 0), P(10, 10), P(0, 10), P(10, 0))).toBe(true);
  });
  it('is false for disjoint segments', () => {
    expect(segmentsIntersect(P(0, 0), P(1, 1), P(5, 5), P(6, 6))).toBe(false);
  });
});

describe('memberSelectedBy', () => {
  const rect = marqueeFromDrag(0, 0, 100, 100).rect; // 0..100 square

  it('window selects only members fully inside', () => {
    expect(memberSelectedBy([P(20, 20), P(80, 80)], rect, 'window')).toBe(true);
    // one endpoint outside → not contained
    expect(memberSelectedBy([P(20, 20), P(120, 80)], rect, 'window')).toBe(false);
  });

  it('crossing selects members that touch (endpoint inside)', () => {
    expect(memberSelectedBy([P(20, 20), P(120, 80)], rect, 'crossing')).toBe(true);
  });

  it('crossing catches a member that passes through with both ends outside', () => {
    // a horizontal line at y=50 from x=-50 to x=150 crosses the square
    expect(memberSelectedBy([P(-50, 50), P(150, 50)], rect, 'crossing')).toBe(true);
    // window would not select it (endpoints outside)
    expect(memberSelectedBy([P(-50, 50), P(150, 50)], rect, 'window')).toBe(false);
  });

  it('selects nothing when fully outside', () => {
    expect(memberSelectedBy([P(200, 200), P(300, 300)], rect, 'crossing')).toBe(false);
  });
});
