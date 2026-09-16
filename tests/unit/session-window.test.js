import { describe, it, expect } from 'vitest';
import { computeSessionUpdate, SESSION_INACTIVITY_WINDOW_MS } from '../../src/app/utils/sessionWindow';

describe('SESSION_INACTIVITY_WINDOW_MS', () => {
  it('is a single, clearly-defined 10 minute constant', () => {
    expect(SESSION_INACTIVITY_WINDOW_MS).toBe(10 * 60 * 1000);
  });
});

describe('computeSessionUpdate', () => {
  it('first-ever visit starts session 1 with one open', () => {
    const now = new Date('2026-01-01T08:00:00Z');
    const result = computeSessionUpdate({ existing: null, now });
    expect(result).toMatchObject({
      sessionCount: 1,
      totalOpens: 1,
      currentSessionOpens: 1,
      isNewSession: true,
    });
    expect(result.currentSessionStartedAt).toEqual(now);
    expect(result.lastActivityAt).toEqual(now);
  });

  it('a refresh two minutes later stays in the same session', () => {
    const first = computeSessionUpdate({ existing: null, now: new Date('2026-01-01T08:00:00Z') });
    const second = computeSessionUpdate({ existing: first, now: new Date('2026-01-01T08:02:00Z') });
    expect(second.isNewSession).toBe(false);
    expect(second.sessionCount).toBe(1);
    expect(second.totalOpens).toBe(2);
    expect(second.currentSessionOpens).toBe(2);
  });

  it('repeated refreshes at 8:04 and a reopen at 8:07 all stay in session 1 (worked example)', () => {
    let state = computeSessionUpdate({ existing: null, now: new Date('2026-01-01T08:00:00Z') });
    state = computeSessionUpdate({ existing: state, now: new Date('2026-01-01T08:02:00Z') });
    state = computeSessionUpdate({ existing: state, now: new Date('2026-01-01T08:04:00Z') });
    state = computeSessionUpdate({ existing: state, now: new Date('2026-01-01T08:07:00Z') });

    expect(state.sessionCount).toBe(1);
    expect(state.totalOpens).toBe(4);
    expect(state.isNewSession).toBe(false);
  });

  it('a return at 8:25 (18 minutes after the last 8:07 activity) starts session 2', () => {
    let state = computeSessionUpdate({ existing: null, now: new Date('2026-01-01T08:00:00Z') });
    state = computeSessionUpdate({ existing: state, now: new Date('2026-01-01T08:07:00Z') });
    state = computeSessionUpdate({ existing: state, now: new Date('2026-01-01T08:25:00Z') });

    expect(state.sessionCount).toBe(2);
    expect(state.isNewSession).toBe(true);
    expect(state.currentSessionOpens).toBe(1);
    expect(state.totalOpens).toBe(3);
  });

  it('a further return at 7:30pm the same day starts session 3', () => {
    let state = computeSessionUpdate({ existing: null, now: new Date('2026-01-01T08:00:00Z') });
    state = computeSessionUpdate({ existing: state, now: new Date('2026-01-01T08:25:00Z') });
    state = computeSessionUpdate({ existing: state, now: new Date('2026-01-01T19:30:00Z') });

    expect(state.sessionCount).toBe(3);
    expect(state.isNewSession).toBe(true);
  });

  it('a gap of exactly the window boundary (10:00 minutes) counts as a new session (strictly greater-than rule)', () => {
    const first = computeSessionUpdate({ existing: null, now: new Date('2026-01-01T08:00:00Z') });
    const exactlyAtWindow = computeSessionUpdate({
      existing: first,
      now: new Date(new Date('2026-01-01T08:00:00Z').getTime() + SESSION_INACTIVITY_WINDOW_MS),
    });
    expect(exactlyAtWindow.isNewSession).toBe(false);

    const justOverWindow = computeSessionUpdate({
      existing: first,
      now: new Date(new Date('2026-01-01T08:00:00Z').getTime() + SESSION_INACTIVITY_WINDOW_MS + 1000),
    });
    expect(justOverWindow.isNewSession).toBe(true);
  });

  it('a gap of 9 minutes 59 seconds stays in the same session (just under the threshold)', () => {
    const first = computeSessionUpdate({ existing: null, now: new Date('2026-01-01T08:00:00Z') });
    const second = computeSessionUpdate({
      existing: first,
      now: new Date(new Date('2026-01-01T08:00:00Z').getTime() + SESSION_INACTIVITY_WINDOW_MS - 1000),
    });
    expect(second.isNewSession).toBe(false);
    expect(second.sessionCount).toBe(1);
  });
});
