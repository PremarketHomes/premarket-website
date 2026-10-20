import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import crypto from 'crypto';

vi.mock('firebase-admin/firestore', () => ({
  FieldValue: { serverTimestamp: () => 'TIMESTAMP' },
}));

const mockBatchGetInvoiceStatuses = vi.fn();
const mockUpdateInvoiceRunItem = vi.fn();
vi.mock('../../src/app/api/services/xeroService.js', () => ({
  batchGetInvoiceStatuses: (...args) => mockBatchGetInvoiceStatuses(...args),
  updateInvoiceRunItem: (...args) => mockUpdateInvoiceRunItem(...args),
}));

const SECRET = 'test-webhook-secret';

function signedRequest(bodyObj, { secret = SECRET, badSignature = false } = {}) {
  const body = JSON.stringify(bodyObj);
  const signature = badSignature
    ? 'not-a-real-signature'
    : crypto.createHmac('sha256', secret).update(Buffer.from(body)).digest('base64');
  return new Request('http://localhost/api/webhooks/xero', {
    method: 'POST',
    headers: { 'x-xero-signature': signature },
    body,
  });
}

describe('POST /api/webhooks/xero', () => {
  const originalKey = process.env.XERO_WEBHOOK_KEY;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.XERO_WEBHOOK_KEY = SECRET;
  });

  afterEach(() => {
    process.env.XERO_WEBHOOK_KEY = originalKey;
  });

  it('fails closed (401) when XERO_WEBHOOK_KEY is not configured, before even checking the signature', async () => {
    delete process.env.XERO_WEBHOOK_KEY;
    const { POST } = await import('../../src/app/api/webhooks/xero/route.js');
    const res = await POST(signedRequest({ events: [{ resourceId: 'inv1' }] }));
    expect(res.status).toBe(401);
    expect(mockBatchGetInvoiceStatuses).not.toHaveBeenCalled();
  });

  it('rejects a request with no signature header', async () => {
    const { POST } = await import('../../src/app/api/webhooks/xero/route.js');
    const req = new Request('http://localhost/x', { method: 'POST', body: JSON.stringify({ events: [] }) });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it('rejects a request with an invalid signature', async () => {
    const { POST } = await import('../../src/app/api/webhooks/xero/route.js');
    const res = await POST(signedRequest({ events: [{ resourceId: 'inv1' }] }, { badSignature: true }));
    expect(res.status).toBe(401);
    expect(mockBatchGetInvoiceStatuses).not.toHaveBeenCalled();
  });

  it('handles the Intent to Receive handshake without touching Xero or Firestore', async () => {
    const { POST } = await import('../../src/app/api/webhooks/xero/route.js');
    const res = await POST(signedRequest({ events: [], entropy: 'abc123' }));
    expect(res.status).toBe(200);
    expect(mockBatchGetInvoiceStatuses).not.toHaveBeenCalled();
  });

  it('never fabricates PAID — fetches the real status from Xero and only writes what it actually says', async () => {
    mockBatchGetInvoiceStatuses.mockResolvedValue([
      { InvoiceID: 'inv1', Status: 'AUTHORISED' },
    ]);
    mockUpdateInvoiceRunItem.mockResolvedValue('item1');

    const { POST } = await import('../../src/app/api/webhooks/xero/route.js');
    const res = await POST(signedRequest({ events: [{ resourceId: 'inv1', eventType: 'UPDATE' }] }));
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(mockBatchGetInvoiceStatuses).toHaveBeenCalledWith(['inv1']);
    // Passed the REAL invoice object through, not a fabricated {Status: 'PAID'}.
    expect(mockUpdateInvoiceRunItem).toHaveBeenCalledWith('inv1', { InvoiceID: 'inv1', Status: 'AUTHORISED' });
    expect(data.updated).toBe(1);
  });

  it('updates correctly when Xero genuinely reports PAID', async () => {
    mockBatchGetInvoiceStatuses.mockResolvedValue([
      { InvoiceID: 'inv1', Status: 'PAID', FullyPaidOnDate: '2026-10-01' },
    ]);
    mockUpdateInvoiceRunItem.mockResolvedValue('item1');

    const { POST } = await import('../../src/app/api/webhooks/xero/route.js');
    const res = await POST(signedRequest({ events: [{ resourceId: 'inv1' }] }));
    expect(res.status).toBe(200);
    expect(mockUpdateInvoiceRunItem).toHaveBeenCalledWith('inv1', { InvoiceID: 'inv1', Status: 'PAID', FullyPaidOnDate: '2026-10-01' });
  });

  it('deduplicates multiple events for the same invoice into a single Xero lookup', async () => {
    mockBatchGetInvoiceStatuses.mockResolvedValue([{ InvoiceID: 'inv1', Status: 'AUTHORISED' }]);
    mockUpdateInvoiceRunItem.mockResolvedValue('item1');

    const { POST } = await import('../../src/app/api/webhooks/xero/route.js');
    await POST(signedRequest({ events: [{ resourceId: 'inv1' }, { resourceId: 'inv1' }] }));
    expect(mockBatchGetInvoiceStatuses).toHaveBeenCalledWith(['inv1']);
  });

  it('returns a 500 (so Xero retries) when the Xero API call itself fails, instead of silently succeeding', async () => {
    mockBatchGetInvoiceStatuses.mockRejectedValue(new Error('Xero API unavailable'));
    const { POST } = await import('../../src/app/api/webhooks/xero/route.js');
    const res = await POST(signedRequest({ events: [{ resourceId: 'inv1' }] }));
    expect(res.status).toBe(500);
  });

  it('handles an empty events array with no resourceIds gracefully (no Xero call)', async () => {
    const { POST } = await import('../../src/app/api/webhooks/xero/route.js');
    const res = await POST(signedRequest({ events: [{}] }));
    const data = await res.json();
    expect(res.status).toBe(200);
    expect(data.received).toBe(0);
    expect(mockBatchGetInvoiceStatuses).not.toHaveBeenCalled();
  });
});
