import { describe, it, expect, vi, beforeEach } from 'vitest';

let mockSendResult;

vi.mock('resend', () => ({
  Resend: class {
    constructor() {}
    get emails() {
      return {
        send: vi.fn(async () => mockSendResult),
      };
    }
  },
}));

describe('sendEmail — surfaces a Resend API-level error instead of swallowing it', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('throws when Resend resolves with { data: null, error } — the SDK never rejects on its own', async () => {
    // This is the exact shape that caused the production incident: an
    // invalid RESEND_API_KEY produces a resolved promise with this
    // shape, not a thrown exception, so every caller's try/catch saw
    // nothing to catch and reported success regardless.
    mockSendResult = {
      data: null,
      error: { name: 'invalid_api_key', message: 'API key is invalid', statusCode: 400 },
    };
    const { sendEmail } = await import('../../src/app/api/services/resendService');

    await expect(
      sendEmail({ to: 'agent@example.com', subject: 'Test', html: '<p>hi</p>' })
    ).rejects.toThrow(/invalid_api_key/);
  });

  it('includes the Resend-reported message and status in the thrown error, for a useful log line', async () => {
    mockSendResult = {
      data: null,
      error: { name: 'invalid_from_address', message: 'from address is not verified', statusCode: 403 },
    };
    const { sendEmail } = await import('../../src/app/api/services/resendService');

    await expect(
      sendEmail({ to: 'agent@example.com', subject: 'Test', html: '<p>hi</p>' })
    ).rejects.toThrow(/from address is not verified/);
  });

  it('resolves normally when Resend reports success', async () => {
    mockSendResult = { data: { id: 'email-123' }, error: null };
    const { sendEmail } = await import('../../src/app/api/services/resendService');

    const result = await sendEmail({ to: 'agent@example.com', subject: 'Test', html: '<p>hi</p>' });
    expect(result).toEqual({ data: { id: 'email-123' }, error: null });
  });
});
