import { describe, it, expect } from 'vitest';
import { computeResizeTarget, runWithConcurrency } from '../../src/app/utils/imageUpload';

describe('computeResizeTarget', () => {
  it('returns null when the image is already at or under the target width', () => {
    expect(computeResizeTarget(2000, 1333, 2000)).toBeNull();
    expect(computeResizeTarget(1200, 800, 2000)).toBeNull();
  });

  it('scales a wide professional camera photo down to the target width', () => {
    expect(computeResizeTarget(6000, 4000, 2000)).toEqual({ width: 2000, height: 1333 });
  });

  it('scales a portrait iPhone photo down, preserving aspect ratio', () => {
    // 4032x3024 is a standard iPhone landscape capture; check portrait too.
    expect(computeResizeTarget(3024, 4032, 2000)).toEqual({ width: 2000, height: 2667 });
  });

  it('is a safe no-op when dimensions are missing', () => {
    expect(computeResizeTarget(0, 0, 2000)).toBeNull();
    expect(computeResizeTarget(undefined, undefined, 2000)).toBeNull();
  });
});

describe('runWithConcurrency', () => {
  it('runs every item and preserves result order regardless of completion order', async () => {
    const items = [30, 10, 20, 5];
    const results = await runWithConcurrency(
      items,
      (delayMs) => new Promise((resolve) => setTimeout(() => resolve(delayMs), delayMs)),
      2
    );
    expect(results.map((r) => r.value)).toEqual([30, 10, 20, 5]);
    expect(results.every((r) => r.ok)).toBe(true);
  });

  it('never runs more than `limit` workers at once', async () => {
    let active = 0;
    let maxActive = 0;
    const items = new Array(10).fill(0);

    await runWithConcurrency(
      items,
      async () => {
        active += 1;
        maxActive = Math.max(maxActive, active);
        await new Promise((resolve) => setTimeout(resolve, 5));
        active -= 1;
      },
      3
    );

    expect(maxActive).toBeLessThanOrEqual(3);
  });

  it('isolates one failure — the rest still complete', async () => {
    const items = [1, 2, 3, 4];
    const results = await runWithConcurrency(
      items,
      async (n) => {
        if (n === 2) throw new Error('boom');
        return n * 10;
      },
      4
    );

    expect(results[0]).toEqual({ ok: true, value: 10 });
    expect(results[1].ok).toBe(false);
    expect(results[1].error.message).toBe('boom');
    expect(results[2]).toEqual({ ok: true, value: 30 });
    expect(results[3]).toEqual({ ok: true, value: 40 });
  });

  it('handles an empty list', async () => {
    const results = await runWithConcurrency([], async () => 1, 4);
    expect(results).toEqual([]);
  });
});
