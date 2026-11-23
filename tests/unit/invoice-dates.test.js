import { describe, it, expect } from 'vitest';
import { invoiceDates, DEFAULT_PAYMENT_TERMS_DAYS } from '../../src/app/api/services/invoiceDates';

describe('invoiceDates — Brisbane calendar, due exactly N days after the invoice date', () => {
  it('14-day terms: dated today in Brisbane, due 14 days later', () => {
    expect(invoiceDates(new Date('2026-11-23T04:00:00Z'), 14)).toEqual({ date: '2026-11-23', dueDate: '2026-12-07', paymentTermsDays: 14 });
  });

  it('before 10am Brisbane (still the previous day in UTC) the invoice is dated the Brisbane day, and still due 14 days after it', () => {
    // 2026-11-23 22:30 UTC = 24 Nov 08:30 in Brisbane. The old due date (UTC calendar + 14) was 7 Dec: 13 days after the invoice date.
    expect(invoiceDates(new Date('2026-11-23T22:30:00Z'), 14)).toEqual({ date: '2026-11-24', dueDate: '2026-12-08', paymentTermsDays: 14 });
  });

  it('just before Brisbane midnight it is still that day', () => {
    expect(invoiceDates(new Date('2026-11-23T13:59:59Z'), 14).date).toBe('2026-11-23');
    expect(invoiceDates(new Date('2026-11-23T14:00:00Z'), 14).date).toBe('2026-11-24');
  });

  it('rolls over months and years', () => {
    expect(invoiceDates(new Date('2026-12-25T02:00:00Z'), 14)).toMatchObject({ date: '2026-12-25', dueDate: '2027-01-08' });
    expect(invoiceDates(new Date('2027-02-20T02:00:00Z'), 14)).toMatchObject({ date: '2027-02-20', dueDate: '2027-03-06' });
  });

  it('honours other whole-day terms, and falls back to 14 for anything else', () => {
    expect(invoiceDates(new Date('2026-11-23T04:00:00Z'), 7).dueDate).toBe('2026-11-30');
    for (const bad of [0, -3, 2.5, '14', null, undefined, NaN]) {
      expect(invoiceDates(new Date('2026-11-23T04:00:00Z'), bad)).toMatchObject({ dueDate: '2026-12-07', paymentTermsDays: DEFAULT_PAYMENT_TERMS_DAYS });
    }
  });
});
