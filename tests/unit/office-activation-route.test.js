import { describe, it, expect, vi, beforeEach } from 'vitest';

const inspect = vi.fn();
const redeem = vi.fn();
vi.mock('../../src/app/api/services/officeActivationService', () => ({
  inspectActivationToken: (...a) => inspect(...a),
  redeemActivationToken: (...a) => redeem(...a),
}));

const post = async (body) => {
  const { POST } = await import('../../src/app/api/office-activation/route');
  return POST(new Request('https://premarket.homes/api/office-activation', { method: 'POST', body: JSON.stringify(body) }));
};

describe('POST /api/office-activation', () => {
  beforeEach(() => {
    inspect.mockReset().mockResolvedValue({ firstName: 'Sam', officeName: 'Harcourts Property Hub' });
    redeem.mockReset().mockResolvedValue({ oobCode: 'abc' });
  });

  it('REGRESSION: a request without an explicit "continue" intent (page load, scanner, prefetch) never mints a Firebase code', async () => {
    for (const body of [{ token: 'T' }, { token: 'T', intent: 'check' }, { token: 'T', intent: 'anything-else' }, { token: 'T', intent: '' }]) {
      const res = await post(body);
      expect(res.status).toBe(200);
    }
    expect(redeem).not.toHaveBeenCalled();
    expect(inspect).toHaveBeenCalledTimes(4);
  });

  it('only { intent: "continue" } mints, and returns just the one-time code', async () => {
    const res = await post({ token: 'T', intent: 'continue' });
    expect(await res.json()).toEqual({ oobCode: 'abc' });
    expect(redeem).toHaveBeenCalledTimes(1);
    expect(inspect).not.toHaveBeenCalled();
  });

  it('responses are never cached, and errors keep safe messages and status codes', async () => {
    expect((await post({ token: 'T' })).headers.get('cache-control')).toBe('no-store');
    inspect.mockRejectedValue(Object.assign(new Error('This activation link has expired'), { status: 410 }));
    const res = await post({ token: 'T' });
    expect(res.status).toBe(410);
    expect((await res.json()).error).toBe('This activation link has expired');
    redeem.mockRejectedValue(new Error('boom: secret detail'));
    const err = await post({ token: 'T', intent: 'continue' });
    expect(err.status).toBe(500);
    expect(JSON.stringify(await err.json())).not.toContain('secret detail');
  });
});
