import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const sendAll = vi.fn(async () => ({ sent: 3, skipped: 0, errors: 0 }));
vi.mock('../../src/app/api/services/newsletterService', () => ({ sendWeeklyBuyerNewsletters: () => sendAll() }));

process.env.CRON_SECRET = 'test-secret';
const { GET, POST } = await import('../../src/app/api/newsletter/send/route');
const req = (method, secret = 'test-secret') =>
  new Request('http://x/api/newsletter/send', { method, headers: secret ? { authorization: `Bearer ${secret}` } : {} });

describe('/api/newsletter/send kill switch', () => {
  const original = process.env.NEWSLETTER_SEND_ENABLED;
  beforeEach(() => sendAll.mockClear());
  afterEach(() => { if (original === undefined) delete process.env.NEWSLETTER_SEND_ENABLED; else process.env.NEWSLETTER_SEND_ENABLED = original; });

  for (const value of [undefined, '', 'false', 'TRUE', '1', 'yes']) {
    it(`sends nothing for the cron and the manual trigger when NEWSLETTER_SEND_ENABLED is ${JSON.stringify(value)}`, async () => {
      if (value === undefined) delete process.env.NEWSLETTER_SEND_ENABLED; else process.env.NEWSLETTER_SEND_ENABLED = value;
      for (const call of [GET(req('GET')), POST(req('POST'))]) {
        const body = await (await call).json();
        expect(body).toMatchObject({ success: true, skipped: true });
      }
      expect(sendAll).not.toHaveBeenCalled();
    });
  }

  it('sends only when explicitly set to "true"', async () => {
    process.env.NEWSLETTER_SEND_ENABLED = 'true';
    const body = await (await GET(req('GET'))).json();
    expect(body).toMatchObject({ success: true, sent: 3 });
    expect(sendAll).toHaveBeenCalledTimes(1);
  });

  it('still requires the cron secret', async () => {
    process.env.NEWSLETTER_SEND_ENABLED = 'true';
    expect((await GET(req('GET', 'wrong'))).status).toBe(401);
    expect((await POST(req('POST', null))).status).toBe(401);
    expect(sendAll).not.toHaveBeenCalled();
  });
});
