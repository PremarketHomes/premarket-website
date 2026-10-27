import { describe, it, expect, beforeEach } from 'vitest';
import { createKioskController, KIOSK_TIMING } from '../../src/app/utils/kioskController';

// Deterministic fake clock/timers
function makeClock() {
  let t = 0; let id = 0; const timers = new Map();
  return {
    now: () => t,
    setTimer: (fn, ms) => { id += 1; timers.set(id, { at: t + ms, fn }); return id; },
    clearTimer: (h) => timers.delete(h),
    advance(ms) {
      const target = t + ms;
      for (;;) {
        const due = [...timers.entries()].filter(([, v]) => v.at <= target).sort((a, b) => a[1].at - b[1].at)[0];
        if (!due) break;
        timers.delete(due[0]); t = due[1].at; due[1].fn();
      }
      t = target;
    },
    pending: () => timers.size,
  };
}

let clock; let commits; let n;
const make = (opts = {}) => createKioskController({
  baseline: 800000,
  newId: () => `op${++n}`,
  onCommit: (o) => commits.push(o),
  now: clock.now, setTimer: clock.setTimer, clearTimer: clock.clearTimer,
  ...opts,
});
beforeEach(() => { clock = makeClock(); commits = []; n = 0; });

const swipe = (c, to = 950000) => { c.gestureStart(); c.gestureMove(to); c.gestureEnd(); };

describe('kiosk controller: deliberate interaction only', () => {
  it('a touch that never moves the slider records nothing', () => {
    const c = make();
    expect(c.gestureStart()).toBe(true);
    c.gestureEnd();
    clock.advance(10000);
    expect(commits).toHaveLength(0);
    expect(c.getState().phase).toBe('idle');
  });

  it('moving to the same value does not count as a change', () => {
    const c = make();
    c.gestureStart(); c.gestureMove(800000); c.gestureEnd();
    clock.advance(10000);
    expect(commits).toHaveLength(0);
  });

  it('a real drag + release records exactly one opinion, after the settling window — not before', () => {
    const c = make();
    swipe(c, 950000);
    expect(c.getState().phase).toBe('settling');
    clock.advance(KIOSK_TIMING.settleMs - 1);
    expect(commits).toHaveLength(0);
    clock.advance(1);
    expect(commits).toEqual([{ id: 'op1', amount: 950000, at: KIOSK_TIMING.settleMs }]);
    expect(c.getState().phase).toBe('thanks');
  });

  it('a re-grip during the settling window cancels the pending save; the FINAL value is what is recorded, once', () => {
    const c = make();
    swipe(c, 900000);
    clock.advance(600);
    c.gestureStart(); c.gestureMove(1000000); c.gestureEnd();
    clock.advance(700);               // would have fired the first timer
    expect(commits).toHaveLength(0);
    clock.advance(600);
    expect(commits).toHaveLength(1);
    expect(commits[0].amount).toBe(1000000);
  });

  it('a re-grip with no further movement still saves the earlier value (once)', () => {
    const c = make();
    swipe(c, 900000);
    clock.advance(400);
    c.gestureStart(); c.gestureEnd();
    clock.advance(KIOSK_TIMING.settleMs);
    expect(commits.map((o) => o.amount)).toEqual([900000]);
  });
});

describe('kiosk controller: no duplicates, no stray saves', () => {
  it('a touch the system cancels (pointercancel / app switch) discards the attempt', () => {
    const c = make();
    c.gestureStart(); c.gestureMove(950000); c.gestureEnd({ cancelled: true });
    clock.advance(10000);
    expect(commits).toHaveLength(0);
    expect(c.getState()).toMatchObject({ phase: 'idle', value: 800000, moved: false });
  });

  it('duplicate / late release events cannot commit twice', () => {
    const c = make();
    swipe(c);
    c.gestureEnd(); c.gestureEnd();   // touchend + emulated mouseup style duplicates
    clock.advance(KIOSK_TIMING.settleMs);
    c.gestureEnd(); c.gestureEnd({ cancelled: false });
    clock.advance(KIOSK_TIMING.thanksMs * 2);
    expect(commits).toHaveLength(1);
  });

  it('a straggler touch right after the commit is ignored (no second opinion for the same person)', () => {
    const c = make();
    swipe(c);
    clock.advance(KIOSK_TIMING.settleMs);
    clock.advance(KIOSK_TIMING.thanksLockMs - 100);
    expect(c.gestureStart()).toBe(false);
    c.gestureMove(990000); c.gestureEnd();
    clock.advance(KIOSK_TIMING.thanksMs);
    expect(commits).toHaveLength(1);
  });

  it('moves and ends without a grab are ignored', () => {
    const c = make();
    c.gestureMove(900000); c.gestureEnd();
    clock.advance(10000);
    expect(commits).toHaveLength(0);
    expect(c.getState().value).toBe(800000);
  });
});

describe('kiosk controller: every visitor starts fresh (no page refresh needed)', () => {
  it('the second, third and fourth visitors each record their own opinion', () => {
    const c = make();
    const amounts = [900000, 700000, 1100000, 850000];
    for (const a of amounts) {
      swipe(c, a);
      clock.advance(KIOSK_TIMING.settleMs);
      clock.advance(KIOSK_TIMING.thanksMs);     // auto-reset for the next visitor
      expect(c.getState()).toMatchObject({ phase: 'idle', value: 800000, moved: false, committed: null });
    }
    expect(commits.map((o) => o.amount)).toEqual(amounts);
    expect(new Set(commits.map((o) => o.id)).size).toBe(4);
  });

  it('the next visitor can start touching during the thank-you (after the short lock) without waiting', () => {
    const c = make();
    swipe(c, 900000);
    clock.advance(KIOSK_TIMING.settleMs + KIOSK_TIMING.thanksLockMs + 50);
    expect(c.gestureStart()).toBe(true);        // ends the thank-you early and starts fresh
    expect(c.getState()).toMatchObject({ phase: 'dragging', value: 800000, committed: null });
    c.gestureMove(1200000); c.gestureEnd();
    clock.advance(KIOSK_TIMING.settleMs);
    expect(commits.map((o) => o.amount)).toEqual([900000, 1200000]);
  });

  it('there is ONE reset timer: a stale reset cannot fire in the middle of the next visitor\'s drag', () => {
    const c = make();
    swipe(c, 900000);
    clock.advance(KIOSK_TIMING.settleMs + KIOSK_TIMING.thanksLockMs + 50);
    c.gestureStart(); c.gestureMove(1000000);   // next visitor mid-drag
    clock.advance(KIOSK_TIMING.thanksMs * 3);   // old thanks timer would have fired by now
    expect(c.getState()).toMatchObject({ phase: 'dragging', value: 1000000 });
  });

  it('commits never depend on saving: onCommit being slow or throwing-later does not block the next visitor', () => {
    let release;
    const c = make({ onCommit: (o) => { commits.push(o); new Promise((r) => { release = r; }); } }); // a save that never finishes
    swipe(c, 900000);
    clock.advance(KIOSK_TIMING.settleMs + KIOSK_TIMING.thanksMs);
    swipe(c, 1000000);
    clock.advance(KIOSK_TIMING.settleMs);
    expect(commits.map((o) => o.amount)).toEqual([900000, 1000000]);
    expect(release).toBeTypeOf('function');
  });
});

describe('kiosk controller: register-interest modal hold', () => {
  it('while the modal is open the visit is kept (no auto-reset), and closing resumes the reset', () => {
    const c = make();
    swipe(c, 900000);
    clock.advance(KIOSK_TIMING.settleMs);
    c.hold();
    clock.advance(KIOSK_TIMING.thanksMs * 4);
    expect(c.getState()).toMatchObject({ phase: 'thanks', held: true });
    expect(c.getState().committed.amount).toBe(900000);
    c.release();
    clock.advance(KIOSK_TIMING.thanksMs);
    expect(c.getState().phase).toBe('idle');
  });

  it('tapping Register while a release is still settling finalises that opinion immediately (once)', () => {
    const c = make();
    swipe(c, 950000);
    clock.advance(300);
    c.hold();
    expect(commits.map((o) => o.amount)).toEqual([950000]);
    clock.advance(KIOSK_TIMING.settleMs * 3);
    expect(commits).toHaveLength(1);
    expect(c.getState().committed.id).toBe('op1');
  });

  it('release({resetNow}) wipes the visit (idle timeout / after registering)', () => {
    const c = make();
    swipe(c, 900000);
    clock.advance(KIOSK_TIMING.settleMs);
    c.hold();
    c.release({ resetNow: true });
    expect(c.getState()).toMatchObject({ phase: 'idle', committed: null, held: false, value: 800000 });
  });

  it('setBaseline updates the starting point only while idle', () => {
    const c = make();
    c.setBaseline(900000);
    expect(c.getState().value).toBe(900000);
    c.gestureStart(); c.gestureMove(1000000);
    c.setBaseline(500000);
    expect(c.getState().value).toBe(1000000);
  });
});
