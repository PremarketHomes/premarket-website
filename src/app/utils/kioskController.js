/**
 * Gesture-to-opinion state machine for the iPad open-home kiosk.
 *
 *   idle ──grab & move──▶ dragging ──release──▶ settling ──(settleMs)──▶ thanks ──▶ idle
 *                            ▲                      │
 *                            └────── re-grip ───────┘   (cancels the pending save)
 *
 * What it guarantees (each is covered by tests):
 *  - An opinion is only recorded after a DELIBERATE interaction: the value
 *    must actually have moved. A touch or brush that doesn't move the slider
 *    records nothing.
 *  - A short settling window after release (default 1.2 s) absorbs ordinary
 *    re-grips, so letting go mid-drag and grabbing again yields ONE opinion at
 *    the final value.
 *  - Exactly one commit per visit: the commit is single-flight, duplicate or
 *    late release events can't fire it twice, and a straggler touch right
 *    after the commit (thanksLockMs) is ignored rather than starting a second
 *    opinion for the same person.
 *  - A touch cancelled by the system (pointercancel, app switch) discards the
 *    attempt instead of saving.
 *  - Every visit starts completely fresh: the second, third… visitor behaves
 *    exactly like the first, without a page refresh (the previous kiosk kept a
 *    "first interaction" ref that was never reset).
 *  - Saving is NOT part of this machine. It hands the opinion to `onCommit`
 *    and moves on, so the next visitor is never blocked by a slow network.
 *
 * Framework-free and clock-injectable so it can be tested deterministically.
 */

export const KIOSK_TIMING = Object.freeze({
  settleMs: 1200,      // quiet period after release before the opinion is recorded
  thanksMs: 2500,      // how long the thank-you stays before resetting for the next visitor
  thanksLockMs: 900,   // ignore stray touches this long after a commit
  modalIdleMs: 60000,  // register-interest modal wipes itself after this much inactivity
  exitHoldMs: 3000,    // staff exit: long-press on the logo
  queuedAfterMs: 1500, // if the server hasn't acknowledged by now, say "stored on this iPad" instead of waiting silently
});

export function createKioskController({
  baseline,
  onCommit,
  onChange = () => {},
  newId,
  timing = KIOSK_TIMING,
  now = () => Date.now(),
  setTimer = (fn, ms) => setTimeout(fn, ms),
  clearTimer = (t) => clearTimeout(t),
}) {
  let phase = 'idle';
  let value = baseline;
  let baselineValue = baseline;
  let moved = false;
  let committed = null; // { id, amount, at } for the current visit
  let held = false;     // true while the register modal is open
  let thanksAt = 0;
  let settleTimer = null;
  let thanksTimer = null;

  const snapshot = () => ({ phase, value, moved, committed, held });
  const emit = () => onChange(snapshot());

  const clearSettle = () => { if (settleTimer !== null) { clearTimer(settleTimer); settleTimer = null; } };
  const clearThanks = () => { if (thanksTimer !== null) { clearTimer(thanksTimer); thanksTimer = null; } };

  function reset() {
    clearSettle();
    clearThanks();
    phase = 'idle';
    value = baselineValue;
    moved = false;
    committed = null;
    emit();
  }

  function startThanksTimer(ms) {
    clearThanks();
    thanksTimer = setTimer(() => { thanksTimer = null; if (!held) reset(); }, ms);
  }

  function commit() {
    settleTimer = null;
    // Single-flight: only a pending (settling) attempt can commit, once.
    if (phase !== 'settling' || committed) return;
    committed = { id: newId(), amount: value, at: now() };
    phase = 'thanks';
    thanksAt = now();
    emit();
    onCommit({ ...committed });
    if (!held) startThanksTimer(timing.thanksMs);
  }

  return {
    getState: snapshot,

    /** A deliberate grab begins (the slider has decided this is not a stray tap). */
    gestureStart() {
      if (phase === 'thanks') {
        // A straggler touch right after committing must not start another opinion.
        if (now() - thanksAt < timing.thanksLockMs) return false;
        // Otherwise it is the NEXT visitor: end the thank-you early and start fresh.
        reset();
      }
      clearSettle(); // re-grip while settling cancels the pending save
      phase = 'dragging';
      emit();
      return true;
    },

    gestureMove(nextValue) {
      if (phase !== 'dragging') return;
      if (nextValue !== value) {
        value = nextValue;
        moved = true;
        emit();
      }
    },

    /** Release. `cancelled` = the system took the touch away (pointercancel, app switch). */
    gestureEnd({ cancelled = false } = {}) {
      if (phase !== 'dragging') return;
      if (cancelled) { reset(); return; }          // discard — never save an interrupted gesture
      if (!moved) { phase = 'idle'; emit(); return; } // nothing was actually changed
      phase = 'settling';
      emit();
      clearSettle();
      settleTimer = setTimer(commit, timing.settleMs);
    },

    /** The register modal opened: keep this visit (so a registration links to its opinion). */
    hold() {
      held = true;
      clearThanks();
      // Tapping "Register interest" is a deliberate end to the interaction: finalise
      // a pending opinion now so the registration is tied to it, not left to race.
      if (phase === 'settling') { clearSettle(); commit(); return; }
      emit();
    },

    /** The register modal closed or finished. */
    release({ resetNow = false } = {}) {
      held = false;
      if (resetNow) { reset(); return; }
      if (phase === 'thanks') startThanksTimer(timing.thanksMs);
      else emit();
    },

    /** Price range arrived or changed: a new de-anchored starting point (only applied while idle). */
    setBaseline(next) {
      baselineValue = next;
      if (phase === 'idle') { value = next; emit(); }
    },

    reset,
    destroy() { clearSettle(); clearThanks(); },
  };
}
