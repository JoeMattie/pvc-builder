import { describe, expect, it, vi } from 'vitest';
import { EventRing, PendingRegistry } from './pvcBridgePlugin';

describe('PendingRegistry', () => {
  it('allocates monotonically increasing ids', () => {
    const reg = new PendingRegistry();
    expect(reg.next()).toBe(1);
    expect(reg.next()).toBe(2);
    expect(reg.next()).toBe(3);
  });

  it('resolves the pending call matching an id', () => {
    const reg = new PendingRegistry();
    const resolve = vi.fn();
    const reject = vi.fn();
    const id = reg.next();
    reg.add(id, resolve, reject);
    expect(reg.settle(id, true, { hello: 'world' })).toBe(true);
    expect(resolve).toHaveBeenCalledWith({ hello: 'world' });
    expect(reject).not.toHaveBeenCalled();
    expect(reg.size).toBe(0);
  });

  it('rejects with the error payload when ok is false', () => {
    const reg = new PendingRegistry();
    const resolve = vi.fn();
    const reject = vi.fn();
    const id = reg.next();
    reg.add(id, resolve, reject);
    expect(reg.settle(id, false, 'boom')).toBe(true);
    expect(reject).toHaveBeenCalledTimes(1);
    expect((reject.mock.calls[0][0] as Error).message).toBe('boom');
    expect(resolve).not.toHaveBeenCalled();
  });

  it('ignores a stray/duplicate result for an unknown id', () => {
    const reg = new PendingRegistry();
    const id = reg.next();
    reg.add(id, vi.fn(), vi.fn());
    expect(reg.settle(id, true, 1)).toBe(true);
    // second settle for the same id is a no-op
    expect(reg.settle(id, true, 2)).toBe(false);
    expect(reg.settle(999, true, 3)).toBe(false);
  });

  it('rejects everything outstanding on disconnect', () => {
    const reg = new PendingRegistry();
    const rejects = [vi.fn(), vi.fn(), vi.fn()];
    for (const r of rejects) reg.add(reg.next(), vi.fn(), r);
    reg.rejectAll('gone');
    for (const r of rejects) {
      expect(r).toHaveBeenCalledTimes(1);
      expect((r.mock.calls[0][0] as Error).message).toBe('gone');
    }
    expect(reg.size).toBe(0);
  });
});

describe('EventRing', () => {
  it('assigns strictly increasing sequence numbers', () => {
    const ring = new EventRing();
    expect(ring.push({ a: 1 }).seq).toBe(1);
    expect(ring.push({ a: 2 }).seq).toBe(2);
    expect(ring.lastSeq).toBe(2);
  });

  it('returns only events after the given sequence', () => {
    const ring = new EventRing();
    ring.push('a');
    ring.push('b');
    ring.push('c');
    expect(ring.since(1).map((r) => r.event)).toEqual(['b', 'c']);
    expect(ring.since(3)).toEqual([]);
    expect(ring.since(0)).toHaveLength(3);
  });

  it('drops the oldest past capacity but keeps seq monotonic and gap-free', () => {
    const ring = new EventRing(2);
    ring.push('a'); // seq 1, evicted
    ring.push('b'); // seq 2
    ring.push('c'); // seq 3
    const all = ring.since(0);
    expect(all.map((r) => r.seq)).toEqual([2, 3]);
    expect(all.map((r) => r.event)).toEqual(['b', 'c']);
    expect(ring.lastSeq).toBe(3);
  });
});
