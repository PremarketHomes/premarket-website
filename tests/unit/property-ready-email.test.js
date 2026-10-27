import { describe, it, expect, vi, beforeEach } from 'vitest';

const send = vi.fn(async () => ({ data: { id: 'e1' }, error: null }));
vi.mock('resend', () => ({ Resend: class { constructor() { this.emails = { send }; } } }));
vi.mock('../../src/app/firebase/adminApp', () => ({ adminDb: {}, adminAuth: {} }));

const { sendPropertyReadyEmail, sendEmail } = await import('../../src/app/api/services/resendService');

beforeEach(() => send.mockClear());

describe('sendPropertyReadyEmail', () => {
  it('uses the agreed subject, copy and a direct property CTA', async () => {
    await sendPropertyReadyEmail('a@example.com', 'Sam', '14 Marine Parade, Kingscliff NSW 2487', 'abc123');
    const [msg] = send.mock.calls[0];
    expect(msg.to).toBe('a@example.com');
    expect(msg.subject).toBe('Your property is ready to review | Premarket');
    expect(msg.html).toContain('Your property is ready to review');
    expect(msg.html).toContain('Hi Sam,');
    expect(msg.html).toContain('A new property has been added to your Premarket dashboard.');
    expect(msg.html).toContain('14 Marine Parade, Kingscliff NSW 2487');
    for (const line of ['Review your property details and photos.', 'Make any final adjustments.', 'Activate your campaign when you’re ready.']) {
      expect(msg.html).toContain(line);
    }
    expect(msg.html).toContain('View Property');
    expect(msg.html).toContain('https://premarket.homes/dashboard/property/abc123');
    expect(msg.text).toContain('14 Marine Parade');
  });

  it('has no gradients and no app-store promotion', async () => {
    await sendPropertyReadyEmail('a@example.com', 'Sam', '1 Test St', 'p1');
    const html = send.mock.calls[0][0].html;
    expect(html).not.toMatch(/gradient/i);
    expect(html).not.toMatch(/app store|google play|download the app|open the premarket app/i);
  });

  it('escapes the address and name, and encodes the property id', async () => {
    await sendPropertyReadyEmail('a@example.com', '<b>Sam</b>', '1 <script>x</script> St', 'a/b?c');
    const html = send.mock.calls[0][0].html;
    expect(html).not.toContain('<script>x</script>');
    expect(html).not.toContain('<b>Sam</b>');
    expect(html).toContain('/dashboard/property/a%2Fb%3Fc');
  });

  it('passes the idempotency key to Resend', async () => {
    await sendPropertyReadyEmail('a@example.com', 'Sam', '1 Test St', 'p1', { idempotencyKey: 'k1' });
    expect(send.mock.calls[0][1]).toEqual({ idempotencyKey: 'k1' });
  });

  it('sendEmail without a key is unchanged (single-argument call)', async () => {
    await sendEmail({ to: 'a@example.com', subject: 's', html: '<p>x</p>' });
    expect(send.mock.calls[0]).toHaveLength(1);
  });

  it('still throws when Resend reports an error', async () => {
    send.mockResolvedValueOnce({ data: null, error: { name: 'x', message: 'bad', statusCode: 401 } });
    await expect(sendPropertyReadyEmail('a@example.com', 'Sam', '1 Test St', 'p1')).rejects.toThrow(/Resend rejected/);
  });
});
