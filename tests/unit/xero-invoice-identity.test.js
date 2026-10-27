import { describe, it, expect, vi } from 'vitest';
import {
  invoiceReferenceCode,
  buildInvoiceReference,
  expectedInvoiceTotal,
  invoiceMatchesItem,
  InvoiceReferenceConflictError,
  cleanXeroContactName,
  disambiguatedXeroContactName,
  isSameBillingEntityContact,
  resolveXeroContact,
} from '../../src/app/api/services/xeroInvoiceIdentity';

describe('invoice reference: unique per run item, stable across retries', () => {
  it('is deterministic: the same run item always produces the same reference (retries find their own invoice)', () => {
    const a = buildInvoiceReference({ prefix: 'PM-', periodStart: new Date('2026-10-24'), itemId: 'itemAAA' });
    const b = buildInvoiceReference({ prefix: 'PM-', periodStart: new Date('2026-10-24'), itemId: 'itemAAA' });
    expect(a).toBe(b);
    expect(a).toMatch(/^PM-October 2026 - [A-F0-9]{10}$/);
  });

  it('REGRESSION: two runs for the SAME office in the SAME month get different references', () => {
    // Old format was "PM-{Month Year} - {contact}", identical for both of these.
    const run1 = buildInvoiceReference({ periodStart: new Date('2026-10-01'), itemId: 'run1-item-hph' });
    const run2 = buildInvoiceReference({ periodStart: new Date('2026-10-30'), itemId: 'run2-item-hph' });
    expect(run1).not.toBe(run2);
  });

  it('REGRESSION: consecutive 30-day cycles whose earliest charges land in the same calendar month never collide', () => {
    // e.g. cycle 1 starts 1 Jan, cycle 2's earliest charge is 31 Jan (still "January")
    const cycle1 = buildInvoiceReference({ periodStart: new Date('2027-01-01'), itemId: 'cycle1-hph' });
    const cycle2 = buildInvoiceReference({ periodStart: new Date('2027-01-31'), itemId: 'cycle2-hph' });
    expect(cycle1.startsWith('PM-January 2027')).toBe(true);
    expect(cycle2.startsWith('PM-January 2027')).toBe(true);
    expect(cycle1).not.toBe(cycle2);
  });

  it('many billing periods for one office: every reference is distinct', () => {
    const refs = [];
    for (let m = 0; m < 24; m += 1) {
      refs.push(buildInvoiceReference({ periodStart: new Date(Date.UTC(2026, m, 15)), itemId: `hph-run-${m}-item` }));
      refs.push(buildInvoiceReference({ periodStart: new Date(Date.UTC(2026, m, 15)), itemId: `hph-adhoc-${m}-item` })); // a second run in the same month
    }
    expect(new Set(refs).size).toBe(refs.length);
  });

  it('the reference does not depend on the contact name, so removing the name suffix cannot change or collide it', () => {
    const ref = buildInvoiceReference({ periodStart: new Date('2026-10-24'), itemId: 'itemAAA' });
    expect(ref).not.toMatch(/Harcourts|Results Realty|ioxigzf4|office:/);
  });

  it('honours the configured prefix and survives a missing/invalid period', () => {
    expect(buildInvoiceReference({ prefix: 'INV-', periodStart: new Date('2026-10-24'), itemId: 'x' }).startsWith('INV-October 2026 - ')).toBe(true);
    expect(buildInvoiceReference({ periodStart: undefined, itemId: 'x' })).toBe(`PM-${invoiceReferenceCode('x')}`);
    expect(buildInvoiceReference({ periodStart: 'not a date', itemId: 'x' })).toBe(`PM-${invoiceReferenceCode('x')}`);
  });

  it('accepts a Firestore Timestamp-like period', () => {
    const ts = { toDate: () => new Date('2026-12-02') };
    expect(buildInvoiceReference({ periodStart: ts, itemId: 'x' })).toMatch(/^PM-December 2026 - /);
  });

  it('refuses to build a reference without a run item id (never a shared reference)', () => {
    expect(() => buildInvoiceReference({ periodStart: new Date(), itemId: '' })).toThrow(/run item id/i);
    expect(() => buildInvoiceReference({ periodStart: new Date() })).toThrow();
  });
});

describe('verifying an invoice found by reference before it is ever reused', () => {
  const ok = { InvoiceID: 'inv1', InvoiceNumber: 'PM-1', Status: 'AUTHORISED', Contact: { ContactID: 'c1' }, Total: 400 };
  const expected = { contactId: 'c1', total: 400, lineCount: 2 };

  it('expectedInvoiceTotal sums each property\'s own ex-GST + GST ($200 x 2, zero GST)', () => {
    expect(expectedInvoiceTotal([{ subtotalEx: 200, gstAmount: 0 }, { subtotalEx: 200, gstAmount: 0 }])).toBe(400);
    expect(expectedInvoiceTotal([{ subtotalEx: 200, gstAmount: 20 }])).toBe(220);
    expect(expectedInvoiceTotal([])).toBe(0);
  });

  it('accepts this item\'s own invoice (same contact, same total)', () => {
    expect(invoiceMatchesItem(ok, expected)).toEqual({ ok: true, reason: null });
  });

  it('REGRESSION: rejects an earlier run\'s invoice that happens to share the reference (different total)', () => {
    const earlier = { ...ok, Total: 200 };
    const verdict = invoiceMatchesItem(earlier, expected);
    expect(verdict.ok).toBe(false);
    expect(verdict.reason).toMatch(/total/i);
  });

  it('rejects an invoice for a different Xero contact', () => {
    expect(invoiceMatchesItem({ ...ok, Contact: { ContactID: 'someone-else' } }, expected)).toMatchObject({ ok: false });
  });

  it.each(['VOIDED', 'DELETED'])('rejects a %s invoice (it is not a live invoice for these charges)', (Status) => {
    expect(invoiceMatchesItem({ ...ok, Status }, expected)).toMatchObject({ ok: false });
  });

  it('rejects when the total cannot be verified at all (a reference match alone is never trusted)', () => {
    expect(invoiceMatchesItem({ ...ok, Total: undefined }, expected)).toMatchObject({ ok: false });
  });

  it('checks line count when Xero returns the lines, and ignores it when it does not (list responses omit them)', () => {
    expect(invoiceMatchesItem({ ...ok, LineItems: [{}, {}, {}] }, expected)).toMatchObject({ ok: false });
    expect(invoiceMatchesItem({ ...ok, LineItems: [{}, {}] }, expected).ok).toBe(true);
    expect(invoiceMatchesItem({ ...ok, LineItems: undefined }, expected).ok).toBe(true);
  });

  it('rejects "no invoice"', () => {
    expect(invoiceMatchesItem(null, expected).ok).toBe(false);
  });

  it('the conflict error says nothing was created or marked invoiced', () => {
    const err = new InvoiceReferenceConflictError('PM-October 2026 - ABC', 'the totals differ');
    expect(err.message).toMatch(/Nothing was created or marked invoiced/);
    expect(err.reference).toBe('PM-October 2026 - ABC');
  });
});

describe('Xero contact name: the legal billing name, no technical suffix', () => {
  const LEGAL = 'Results Realty (QLD) Pty Ltd ATF Results Realty Trust trading as Harcourts Property Hub';

  it('HPH appears under its confirmed legal billing name exactly', () => {
    expect(cleanXeroContactName({ agencyName: 'Harcourts Property Hub', billingEntityKey: 'office:ioxigzf4hcRtowqL4C94' }, LEGAL)).toBe(LEGAL);
  });
  it('falls back to the agency name, then a neutral label — never the entity key', () => {
    expect(cleanXeroContactName({ agencyName: 'Evolve Sales', billingEntityKey: 'agent:abc' }, '')).toBe('Evolve Sales');
    expect(cleanXeroContactName({ billingEntityKey: 'office:ioxigzf4hcRtowqL4C94' }, '')).toBe('Premarket customer');
  });
  it('trims whitespace', () => {
    expect(cleanXeroContactName({}, `  ${LEGAL}  `)).toBe(LEGAL);
  });
  it('the disambiguating suffix exists only as a function used for a real clash, and never leaks "office:"', () => {
    expect(disambiguatedXeroContactName('Acme', 'office:ioxigzf4hcRtowqL4C94')).toBe('Acme (ioxigzf4)');
    expect(disambiguatedXeroContactName('Acme', 'agent:uid12345678')).toBe('Acme (uid12345)');
  });
});

describe('is an existing Xero contact the same billing entity?', () => {
  it('same ABN (any formatting) -> same entity', () => {
    expect(isSameBillingEntityContact({ TaxNumber: '68677191726' }, { abn: '68 677 191 726' })).toBe(true);
  });
  it('different ABN -> a DIFFERENT entity, even if the email matches', () => {
    expect(isSameBillingEntityContact({ TaxNumber: '11111111111', EmailAddress: 'a@x.com' }, { abn: '68 677 191 726', email: 'a@x.com' })).toBe(false);
  });
  it('no ABN on one side -> same accounts email (case-insensitive) decides', () => {
    expect(isSameBillingEntityContact({ EmailAddress: 'Chris@propertyhubgc.com.au' }, { email: 'chris@propertyhubgc.com.au' })).toBe(true);
    expect(isSameBillingEntityContact({ EmailAddress: 'other@x.com' }, { email: 'chris@propertyhubgc.com.au' })).toBe(false);
  });
  it('cannot establish it -> NO (keeping entities apart is the safe error)', () => {
    expect(isSameBillingEntityContact({}, { email: 'a@x.com' })).toBe(false);
    expect(isSameBillingEntityContact({ EmailAddress: 'a@x.com' }, {})).toBe(false);
  });
});

describe('resolveXeroContact', () => {
  const LEGAL = 'Results Realty (QLD) Pty Ltd ATF Results Realty Trust trading as Harcourts Property Hub';
  const hphItem = { agencyName: 'Harcourts Property Hub', billingEntityKey: 'office:ioxigzf4hcRtowqL4C94' };
  const hphConfirmed = { name: 'Chris Manby', email: 'Chris@propertyhubgc.com.au', billingName: LEGAL, abn: '68 677 191 726', address: { line1: '102-104/6 Waterfront Place' } };

  const makeXero = (existing = {}) => {
    const contacts = new Map(Object.entries(existing));
    let n = 0;
    return {
      contacts,
      getContactById: vi.fn(async (id) => [...contacts.values()].find((c) => c.ContactID === id) || null),
      searchContactByName: vi.fn(async (name) => contacts.get(name) || null),
      findOrCreateContact: vi.fn(async ({ name, email, taxNumber }) => {
        if (contacts.has(name)) return contacts.get(name);
        n += 1;
        const c = { ContactID: `new${n}`, Name: name, EmailAddress: email, TaxNumber: taxNumber };
        contacts.set(name, c);
        return c;
      }),
    };
  };

  it('first run: creates ONE contact named exactly the legal billing name, with the ABN, accounts email and address', async () => {
    const xero = makeXero();
    const { contact, how } = await resolveXeroContact({ item: hphItem, confirmed: hphConfirmed, storedContactId: null, xero });
    expect(how).toBe('created');
    expect(contact.Name).toBe(LEGAL);
    expect(xero.findOrCreateContact).toHaveBeenCalledTimes(1);
    expect(xero.findOrCreateContact.mock.calls[0][0]).toMatchObject({
      name: LEGAL, email: 'Chris@propertyhubgc.com.au', firstName: 'Chris', lastName: 'Manby',
      taxNumber: '68 677 191 726', address: { line1: '102-104/6 Waterfront Place' },
    });
    expect([...xero.contacts.keys()]).toEqual([LEGAL]);                    // no suffixed variant anywhere
  });

  it('later runs: the remembered contact id is used directly — no name lookup, no new contact', async () => {
    const xero = makeXero({ [LEGAL]: { ContactID: 'hphContact', Name: LEGAL } });
    const { contact, how } = await resolveXeroContact({ item: hphItem, confirmed: hphConfirmed, storedContactId: 'hphContact', xero });
    expect(how).toBe('stored');
    expect(contact.ContactID).toBe('hphContact');
    expect(xero.searchContactByName).not.toHaveBeenCalled();
    expect(xero.findOrCreateContact).not.toHaveBeenCalled();
  });

  it('a remembered contact that no longer exists in Xero falls back to the legal name (and does not invent a suffix)', async () => {
    const xero = makeXero();
    const { contact, how } = await resolveXeroContact({ item: hphItem, confirmed: hphConfirmed, storedContactId: 'deletedInXero', xero });
    expect(how).toBe('created');
    expect(contact.Name).toBe(LEGAL);
  });

  it('an existing contact for the SAME legal entity (same ABN) is reused rather than duplicated', async () => {
    const xero = makeXero({ [LEGAL]: { ContactID: 'manual1', Name: LEGAL, TaxNumber: '68677191726', EmailAddress: 'someone@else.com' } });
    const { contact, how } = await resolveXeroContact({ item: hphItem, confirmed: hphConfirmed, storedContactId: null, xero });
    expect(how).toBe('found');
    expect(contact.ContactID).toBe('manual1');
    expect(xero.findOrCreateContact).not.toHaveBeenCalled();
  });

  it('SECURITY: a DIFFERENT entity that already owns the same name is never merged — only then is a suffix used', async () => {
    const xero = makeXero({ 'Harcourts Property Hub': { ContactID: 'other', Name: 'Harcourts Property Hub', TaxNumber: '11111111111', EmailAddress: 'x@y.com' } });
    const confirmed = { ...hphConfirmed, billingName: 'Harcourts Property Hub' };
    const { contact, how } = await resolveXeroContact({ item: hphItem, confirmed, storedContactId: null, xero });
    expect(how).toBe('disambiguated');
    expect(contact.ContactID).not.toBe('other');
    expect(contact.Name).toBe('Harcourts Property Hub (ioxigzf4)');
  });

  it('refuses an archived Xero contact with a clear message', async () => {
    const xero = makeXero({ [LEGAL]: { ContactID: 'arch', Name: LEGAL, ContactStatus: 'ARCHIVED' } });
    await expect(resolveXeroContact({ item: hphItem, confirmed: hphConfirmed, storedContactId: 'arch', xero }))
      .rejects.toThrow(/archived/i);
  });
});
