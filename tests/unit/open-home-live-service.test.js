// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';

// The buyer's phone talking to the live pilot API (open-home/liveService.js): exactly what each request carries, and
// that only the opinion (one per phone, so safe to resend) is retried after a dropped connection or a server error.

const { createLiveService } = await import('../../src/app/open-home/liveService');
const CODE = 'abcdefghjkmnpqrs';

let calls;
function respond(...replies) {
  calls = [];
  const queue = [...replies];
  global.fetch = vi.fn(async (url, init) => {
    calls.push({ url, init, body: init.body ? JSON.parse(init.body) : null });
    const next = queue.length > 1 ? queue.shift() : queue[0];
    if (next === 'offline') throw new TypeError('Failed to fetch');
    return { ok: next.status < 300, status: next.status, json: async () => next.body || {} };
  });
}

beforeEach(() => {
  window.localStorage.clear();
  vi.useFakeTimers({ toFake: ['setTimeout'] });
});

const run = async (p) => { const done = p; await vi.runAllTimersAsync(); return done; };

describe('live service (buyer’s phone)', () => {
  it('the opinion request carries the amount and a per-phone token only, with no cookies or referrer', async () => {
    respond({ status: 201, body: { ok: true } });
    const svc = createLiveService(CODE);
    expect(await run(svc.submitOpinion(1250000))).toEqual({ ok: true });
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(`/api/open-home/visit/${CODE}/opinion`);
    expect(Object.keys(calls[0].body).sort()).toEqual(['amount', 'device']);
    expect(calls[0].body.amount).toBe(1250000);
    expect(calls[0].body.device).toMatch(/^[A-Za-z0-9_-]{32}$/);
    expect(calls[0].init).toMatchObject({ method: 'POST', credentials: 'omit', referrerPolicy: 'no-referrer' });
  });

  it('a server error or dropped connection resends the same opinion (same token, so it can only count once), up to 3 tries', async () => {
    respond({ status: 500, body: { error: 'Something went wrong. Please try again.' } }, 'offline', { status: 201, body: { ok: true } });
    const svc = createLiveService(CODE);
    expect(await run(svc.submitOpinion(1300000))).toEqual({ ok: true });
    expect(calls).toHaveLength(3);
    expect(new Set(calls.map((c) => JSON.stringify(c.body))).size).toBe(1);

    respond({ status: 500, body: {} });
    const res = await run(createLiveService(CODE).submitOpinion(1300000));
    expect(res).toMatchObject({ ok: false, code: 'server' });
    expect(calls).toHaveLength(3);
  });

  it('a definite answer (finished, bad amount) is not resent', async () => {
    for (const reply of [{ status: 410, body: { code: 'ended', error: 'This open home has finished.' } }, { status: 400, body: { code: 'bad-amount', error: 'Please choose a price on the slider.' } }]) {
      respond(reply);
      expect(await run(createLiveService(CODE).submitOpinion(1300000))).toMatchObject({ ok: false, code: reply.body.code });
      expect(calls).toHaveLength(1);
    }
  });

  it('check-in is never resent automatically (it would register the buyer twice), and never carries the opinion token', async () => {
    respond({ status: 500, body: {} });
    const svc = createLiveService(CODE);
    expect(await run(svc.checkIn({ fullName: 'Olivia Bennett', mobile: '0491 570 006', email: 'olivia@example.com', updatesOptIn: false }))).toMatchObject({ ok: false, code: 'server' });
    expect(calls).toHaveLength(1);
    expect(Object.keys(calls[0].body).sort()).toEqual(['email', 'fullName', 'mobile', 'updatesOptIn']);
  });
});
