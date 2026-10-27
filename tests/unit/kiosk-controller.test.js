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

describe('kiosk controller: nothing is recorded until the buyer approves', () => {
  it('releasing the slider only ASKS — it never records anything by itself', () => {
    const c = make();
    swipe(c, 950000);
    expect(c.getState()).toMatchObject({ phase: 'confirming', value: 950000 });
    clock.advance(KIOSK_TIMING.confirmIdleMs - 1);
    expect(commits).toHaveLength(0);
  });

  it('approving records exactly one opinion at the value shown', () => {
    const c = make();
    swipe(c, 950000);
    expect(c.approve()).toBe(true);
    expect(commits).toEqual([{ id: 'op1', amount: 950000, at: 0 }]);
    expect(c.getState().phase).toBe('thanks');
  });

  it('a double tap on approve records once', () => {
    const c = make();
    swipe(c);
    expect(c.approve()).toBe(true);
    expect(c.approve()).toBe(false);
    expect(c.approve()).toBe(false);
    clock.advance(KIOSK_TIMING.thanksMs * 2);
    expect(commits).toHaveLength(1);
  });

  it('approve with nothing to approve does nothing (idle, dragging, already thanked)', () => {
    const c = make();
    expect(c.approve()).toBe(false);
    c.gestureStart(); c.gestureMove(900000);
    expect(c.approve()).toBe(false);          // still dragging
    expect(commits).toHaveLength(0);
  });

  it('an opinion that is never approved is discarded when the buyer walks away', () => {
    const c = make();
    swipe(c, 950000);
    clock.advance(KIOSK_TIMING.confirmIdleMs);
    expect(commits).toHaveLength(0);
    expect(c.getState()).toMatchObject({ phase: 'idle', value: 800000, moved: false, committed: null });
    expect(c.approve()).toBe(false);          // a late tap on a vanished prompt records nothing
  });

  it('"Start again" (reset) discards the unapproved opinion', () => {
    const c = make();
    swipe(c, 950000);
    c.reset();
    clock.advance(KIOSK_TIMING.confirmIdleMs * 2);
    expect(commits).toHaveLength(0);
    expect(c.getState()).toMatchObject({ phase: 'idle', value: 800000 });
  });

  it('opening Register interest while an opinion is unapproved discards it (the registration stands alone)', () => {
    const c = make();
    swipe(c, 950000);
    c.hold();
    expect(c.getState()).toMatchObject({ phase: 'idle', value: 800000, moved: false, held: true });
    clock.advance(KIOSK_TIMING.confirmIdleMs * 2);
    expect(commits).toHaveLength(0);
  });
});

describe('kiosk controller: deliberate interaction only', () => {
  it('a touch that never moves the slider asks nothing and records nothing', () => {
    const c = make();
    expect(c.gestureStart()).toBe(true);
    c.gestureEnd();
    expect(c.getState().phase).toBe('idle');
    expect(c.approve()).toBe(false);
    clock.advance(KIOSK_TIMING.confirmIdleMs);
    expect(commits).toHaveLength(0);
  });

  it('moving to the same value does not count as a change', () => {
    const c = make();
    c.gestureStart(); c.gestureMove(800000); c.gestureEnd();
    expect(c.getState().phase).toBe('idle');
  });

  it('a re-grip while the question is showing keeps it live: approving records the FINAL value, once', () => {
    const c = make();
    swipe(c, 900000);
    clock.advance(5000);
    expect(c.gestureStart()).toBe(true);
    expect(c.getState().phase).toBe('dragging');
    c.gestureMove(1000000); c.gestureEnd();
    expect(c.getState()).toMatchObject({ phase: 'confirming', value: 1000000 });
    c.approve();
    expect(commits.map((o) => o.amount)).toEqual([1000000]);
  });

  it('re-gripping restarts the walk-away timer (a buyer still adjusting is not timed out)', () => {
    const c = make();
    swipe(c, 900000);
    clock.advance(KIOSK_TIMING.confirmIdleMs - 1000);
    c.gestureStart(); c.gestureMove(920000); c.gestureEnd();
    clock.advance(KIOSK_TIMING.confirmIdleMs - 1000);   // would have expired the first timer
    expect(c.getState().phase).toBe('confirming');
    c.approve();
    expect(commits.map((o) => o.amount)).toEqual([920000]);
  });
});

describe('kiosk controller: no duplicates, no stray saves', () => {
  it('a touch the system cancels (pointercancel / app switch) discards the attempt', () => {
    const c = make();
    c.gestureStart(); c.gestureMove(950000); c.gestureEnd({ cancelled: true });
    expect(c.getState()).toMatchObject({ phase: 'idle', value: 800000, moved: false });
    expect(c.approve()).toBe(false);
  });

  it('duplicate / late release events cannot ask or commit twice', () => {
    const c = make();
    swipe(c);
    c.gestureEnd(); c.gestureEnd();   // touchend + emulated mouseup style duplicates
    c.approve();
    c.gestureEnd(); c.gestureEnd({ cancelled: false });
    clock.advance(KIOSK_TIMING.thanksMs * 2);
    expect(commits).toHaveLength(1);
  });

  it('a straggler touch right after the approval is ignored (no second opinion for the same person)', () => {
    const c = make();
    swipe(c);
    c.approve();
    clock.advance(KIOSK_TIMING.thanksLockMs - 100);
    expect(c.gestureStart()).toBe(false);
    c.gestureMove(990000); c.gestureEnd();
    clock.advance(KIOSK_TIMING.thanksMs);
    expect(commits).toHaveLength(1);
  });

  it('moves and ends without a grab are ignored', () => {
    const c = make();
    c.gestureMove(900000); c.gestureEnd();
    expect(c.getState()).toMatchObject({ phase: 'idle', value: 800000 });
    expect(commits).toHaveLength(0);
  });
});

describe('kiosk controller: every visitor starts fresh (no page refresh needed)', () => {
  it('the second, third and fourth visitors each approve their own opinion', () => {
    const c = make();
    const amounts = [900000, 700000, 1100000, 850000];
    for (const a of amounts) {
      swipe(c, a);
      c.approve();
      clock.advance(KIOSK_TIMING.thanksMs);     // auto-reset for the next visitor
      expect(c.getState()).toMatchObject({ phase: 'idle', value: 800000, moved: false, committed: null });
    }
    expect(commits.map((o) => o.amount)).toEqual(amounts);
    expect(new Set(commits.map((o) => o.id)).size).toBe(4);
  });

  it('a visitor who walks away without approving leaves nothing behind for the next', () => {
    const c = make();
    swipe(c, 900000);                           // visitor 1 never approves
    clock.advance(KIOSK_TIMING.confirmIdleMs);
    swipe(c, 1100000); c.approve();             // visitor 2
    expect(commits.map((o) => o.amount)).toEqual([1100000]);
  });

  it('the next visitor can start touching during the thank-you (after the short lock) without waiting', () => {
    const c = make();
    swipe(c, 900000); c.approve();
    clock.advance(KIOSK_TIMING.thanksLockMs + 50);
    expect(c.gestureStart()).toBe(true);        // ends the thank-you early and starts fresh
    expect(c.getState()).toMatchObject({ phase: 'dragging', value: 800000, committed: null });
    c.gestureMove(1200000); c.gestureEnd(); c.approve();
    expect(commits.map((o) => o.amount)).toEqual([900000, 1200000]);
  });

  it('there is ONE reset timer: a stale reset cannot fire in the middle of the next visitor\'s drag', () => {
    const c = make();
    swipe(c, 900000); c.approve();
    clock.advance(KIOSK_TIMING.thanksLockMs + 50);
    c.gestureStart(); c.gestureMove(1000000);   // next visitor mid-drag
    clock.advance(KIOSK_TIMING.thanksMs * 3);   // the old thanks timer would have fired by now
    expect(c.getState()).toMatchObject({ phase: 'dragging', value: 1000000 });
  });

  it('commits never depend on saving: a save that never finishes does not block the next visitor', () => {
    let release;
    const c = make({ onCommit: (o) => { commits.push(o); new Promise((r) => { release = r; }); } });
    swipe(c, 900000); c.approve();
    clock.advance(KIOSK_TIMING.thanksMs);
    swipe(c, 1000000); c.approve();
    expect(commits.map((o) => o.amount)).toEqual([900000, 1000000]);
    expect(release).toBeTypeOf('function');
  });
});

describe('kiosk controller: register-interest modal hold', () => {
  it('while the modal is open an APPROVED visit is kept (no auto-reset), and closing resumes the reset', () => {
    const c = make();
    swipe(c, 900000); c.approve();
    c.hold();
    clock.advance(KIOSK_TIMING.thanksMs * 4);
    expect(c.getState()).toMatchObject({ phase: 'thanks', held: true });
    expect(c.getState().committed.amount).toBe(900000);
    c.release();
    clock.advance(KIOSK_TIMING.thanksMs);
    expect(c.getState().phase).toBe('idle');
  });

  it('release({resetNow}) wipes the visit (idle timeout / after registering)', () => {
    const c = make();
    swipe(c, 900000); c.approve();
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
