/**
 * Gesture-to-opinion state machine for the iPad open-home kiosk.
 *
 *   idle ──grab & move──▶ dragging ──release──▶ confirming ──APPROVE──▶ thanks ──▶ idle
 *                            ▲                      │  │
 *                            └────── re-grip ───────┘  └─ walk away / Start again ─▶ idle (nothing saved)
 *
 * What it guarantees (each is covered by tests):
 *  - Nothing is recorded until the buyer APPROVES it. Releasing the slider only
 *    asks "Happy with $X?"; an opinion that is never approved (the buyer walks
 *    away, taps Start again, or opens Register interest instead) is discarded.
 *  - Only a DELIBERATE interaction can even reach that question: the value must
 *    actually have moved. A touch or brush that doesn't move the slider asks and
 *    records nothing.
 *  - While the question is showing the slider stays live: a re-grip changes the
 *    value and the question re-asks about the FINAL value.
 *  - Exactly one commit per visit: approve is single-flight, a double tap can't
 *    record twice, and a straggler touch right after the commit (thanksLockMs)
 *    is ignored rather than starting a second opinion for the same person.
 *  - A touch cancelled by the system (pointercancel, app switch) discards the
 *    attempt.
 *  - Every visit starts completely fresh: the second, third… visitor behaves
 *    exactly like the first, without a page refresh.
 *  - Saving is NOT part of this machine. It hands the approved opinion to
 *    `onCommit` and moves on, so the next visitor is never blocked by a slow
 *    network.
 *
 * Framework-free and clock-injectable so it can be tested deterministically.
 */

export const KIOSK_TIMING = Object.freeze({
  confirmIdleMs: 20000, // an unapproved opinion is discarded if the buyer walks away for this long
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
  let confirmTimer = null;
  let thanksTimer = null;

  const snapshot = () => ({ phase, value, moved, committed, held });
  const emit = () => onChange(snapshot());

  const clearConfirm = () => { if (confirmTimer !== null) { clearTimer(confirmTimer); confirmTimer = null; } };
  const clearThanks = () => { if (thanksTimer !== null) { clearTimer(thanksTimer); thanksTimer = null; } };

  function reset() {
    clearConfirm();
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
    // Single-flight: only a pending (confirming) attempt can commit, once.
    if (phase !== 'confirming' || committed) return false;
    clearConfirm();
    committed = { id: newId(), amount: value, at: now() };
    phase = 'thanks';
    thanksAt = now();
    emit();
    onCommit({ ...committed });
    if (!held) startThanksTimer(timing.thanksMs);
    return true;
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
      clearConfirm(); // a re-grip while the question is showing: ask again about the final value
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
      if (cancelled) { reset(); return; }             // discard — never keep an interrupted gesture
      if (!moved) { phase = 'idle'; emit(); return; } // nothing was actually changed: nothing to confirm
      phase = 'confirming';                           // ask "Happy with $X?" — nothing is recorded yet
      emit();
      clearConfirm();
      confirmTimer = setTimer(() => { confirmTimer = null; reset(); }, timing.confirmIdleMs); // walked away: discard
    },

    /** The buyer approved their opinion. Returns false if there was nothing to approve. */
    approve() { return commit(); },

    /** The register modal opened: keep this visit (so a registration links to its opinion). */
    hold() {
      held = true;
      clearThanks();
      // Opening Register interest while an opinion is still waiting for approval: that opinion
      // was never approved, so it is discarded (the registration stands on its own).
      if (phase === 'confirming' || phase === 'dragging') {
        clearConfirm();
        phase = 'idle';
        value = baselineValue;
        moved = false;
      }
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
    destroy() { clearConfirm(); clearThanks(); },
  };
}
