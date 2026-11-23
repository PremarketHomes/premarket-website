import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockGetInvoiceById = vi.fn();
const mockGetInvoiceHistory = vi.fn();
vi.mock('../../src/app/api/services/xeroService', () => ({
  getInvoiceById: (...a) => mockGetInvoiceById(...a),
  getInvoiceHistory: (...a) => mockGetInvoiceHistory(...a),
}));

import { deliveryEvidence, checkInvoiceDelivery } from '../../src/app/api/services/invoiceDelivery';

const approved = { Changes: 'Approved', DateUTCString: '2026-11-23T04:13:25', User: 'Premarket', Details: 'INV-0003 to Results Realty for 600.00.' };

describe('deliveryEvidence — has Xero emailed it? (if in doubt: yes, so nothing is ever emailed twice)', () => {
  it('SentToContact means sent', () => {
    expect(deliveryEvidence({ SentToContact: true }, [approved])).toMatchObject({ emailed: true, evidence: expect.stringMatching(/marks this invoice as sent/) });
  });

  it('a history record about sending/emailing means sent, even without the flag', () => {
    for (const r of [
      { Changes: 'Sent', Details: 'This invoice has been sent to Chris@propertyhubgc.com.au' },
      { Changes: 'Emailed', Details: '' },
      { Changes: 'Note', Details: 'Invoice email sent to accounts' },
    ]) {
      expect(deliveryEvidence({ SentToContact: false }, [approved, r]).emailed).toBe(true);
    }
  });

  it('only created/approved history and no flag: not sent', () => {
    const e = deliveryEvidence({ SentToContact: false }, [{ Changes: 'Created', Details: 'INV-0003 draft' }, approved]);
    expect(e).toMatchObject({ emailed: false, evidence: 'Xero has no record of this invoice being sent.' });
    expect(e.history).toEqual([
      { when: null, user: null, changes: 'Created', details: 'INV-0003 draft' },
      { when: '2026-11-23T04:13:25Z', user: 'Premarket', changes: 'Approved', details: approved.Details },
    ]);
  });

  it('reads Xero /Date(ms)/ timestamps too', () => {
    expect(deliveryEvidence({}, [{ Changes: 'Approved', DateUTC: '/Date(1795400005000+0000)/' }]).history[0].when).toBe(new Date(1795400005000).toISOString());
  });
});

describe('checkInvoiceDelivery — read-only Xero lookup', () => {
  beforeEach(() => vi.clearAllMocks());

  it('reports the invoice as Xero holds it, with the evidence', async () => {
    mockGetInvoiceById.mockResolvedValue({
      InvoiceID: 'inv3', InvoiceNumber: 'INV-0003', Status: 'AUTHORISED', SentToContact: true,
      Contact: { Name: 'Results Realty (QLD) Pty Ltd' }, Total: 600, TotalTax: 0, AmountDue: 600,
      DateString: '2026-11-23T00:00:00', DueDateString: '2026-12-07T00:00:00',
    });
    mockGetInvoiceHistory.mockResolvedValue([approved]);
    expect(await checkInvoiceDelivery('inv3')).toMatchObject({
      found: true, invoiceNumber: 'INV-0003', status: 'AUTHORISED', sentToContact: true, emailed: true,
      contactName: 'Results Realty (QLD) Pty Ltd', total: 600, totalTax: 0, amountDue: 600, date: '2026-11-23', dueDate: '2026-12-07',
    });
  });

  it('an invoice Xero does not have: found false, no history call', async () => {
    mockGetInvoiceById.mockResolvedValue(null);
    expect(await checkInvoiceDelivery('nope')).toEqual({ found: false, invoiceId: 'nope' });
    expect(mockGetInvoiceHistory).not.toHaveBeenCalled();
  });
});
