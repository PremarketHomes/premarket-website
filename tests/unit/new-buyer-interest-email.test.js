import { describe, it, expect, vi, beforeEach } from 'vitest';

const sentEmails = [];

vi.mock('resend', () => ({
  Resend: class {
    constructor() {}
    get emails() {
      return {
        send: vi.fn(async (payload) => {
          sentEmails.push(payload);
          return { id: 'mock-id' };
        }),
      };
    }
  },
}));

describe('sendNewBuyerInterestEmail', () => {
  beforeEach(() => {
    sentEmails.length = 0;
  });

  it('escapes buyer-supplied HTML in name, email and phone — never trusted as markup', async () => {
    const { sendNewBuyerInterestEmail } = await import('../../src/app/api/services/resendService');
    await sendNewBuyerInterestEmail({
      agentEmail: 'agent@example.com',
      agentFirstName: 'Alex',
      propertyAddress: '1 Example St',
      propertyId: 'prop-1',
      buyerName: '<img src=x onerror=alert(1)>',
      buyerEmail: 'jane"><script>alert(1)</script>@example.com',
      buyerPhone: '0400<br>000',
      nextAction: 'contact',
    });

    expect(sentEmails).toHaveLength(1);
    const html = sentEmails[0].html;
    expect(html).not.toContain('<img src=x onerror=alert(1)>');
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;img');
  });

  it('includes finance status, FHB and investor tags when present', async () => {
    const { sendNewBuyerInterestEmail } = await import('../../src/app/api/services/resendService');
    await sendNewBuyerInterestEmail({
      agentEmail: 'agent@example.com',
      agentFirstName: 'Alex',
      propertyAddress: '1 Example St',
      propertyId: 'prop-1',
      buyerName: 'Jane Buyer',
      nextAction: 'inspection',
      timeframe: 'asap',
      buyerType: 'cash',
      isFirstHomeBuyer: true,
      isInvestor: false,
    });

    const html = sentEmails[0].html;
    expect(html).toContain('Arrange an inspection');
    expect(html).toContain('ASAP');
    expect(html).toContain('Cash buyer');
    expect(html).toContain('First home buyer');
    expect(html).not.toContain('Investor');
  });

  it('omits timeframe/finance/buyer-type rows entirely when nothing optional was collected', async () => {
    const { sendNewBuyerInterestEmail } = await import('../../src/app/api/services/resendService');
    await sendNewBuyerInterestEmail({
      agentEmail: 'agent@example.com',
      agentFirstName: 'Alex',
      propertyAddress: '1 Example St',
      propertyId: 'prop-1',
      buyerName: 'Jane Buyer',
      nextAction: 'contact',
    });

    const html = sentEmails[0].html;
    expect(html).not.toContain('Timeframe');
    expect(html).not.toContain('Finance');
    expect(html).not.toContain('Buyer type');
    // "Wants" is the one row that's always present, by design.
    expect(html).toContain('Wants');
  });

  it('includes a dashboard CTA linking to the specific property', async () => {
    const { sendNewBuyerInterestEmail } = await import('../../src/app/api/services/resendService');
    await sendNewBuyerInterestEmail({
      agentEmail: 'agent@example.com',
      propertyAddress: '1 Example St',
      propertyId: 'prop-abc123',
      buyerName: 'Jane Buyer',
      nextAction: 'contact',
    });

    const html = sentEmails[0].html;
    expect(html).toContain('/dashboard/property/prop-abc123');
  });

  it('never claims a buyer registered an offer or a commitment to buy', async () => {
    const { sendNewBuyerInterestEmail } = await import('../../src/app/api/services/resendService');
    await sendNewBuyerInterestEmail({
      agentEmail: 'agent@example.com',
      propertyAddress: '1 Example St',
      propertyId: 'prop-1',
      buyerName: 'Jane Buyer',
      nextAction: 'contact',
    });

    const html = sentEmails[0].html.toLowerCase();
    expect(html).not.toContain('offer to purchase');
    expect(html).not.toContain('made an offer');
  });

  it('never describes a buyer as "qualified" or "serious" — only what their own answers support', async () => {
    const { sendNewBuyerInterestEmail } = await import('../../src/app/api/services/resendService');
    await sendNewBuyerInterestEmail({
      agentEmail: 'agent@example.com',
      propertyAddress: '1 Example St',
      propertyId: 'prop-1',
      buyerName: 'Jane Buyer',
      nextAction: 'contact',
      buyerType: 'cash',
      timeframe: 'asap',
      isFirstHomeBuyer: true,
    });

    const html = sentEmails[0].html.toLowerCase();
    expect(html).not.toContain('qualified');
    expect(html).not.toContain('serious');
  });

  it('shows the full buyer email and phone as clickable mailto:/tel: links, never masked', async () => {
    const { sendNewBuyerInterestEmail } = await import('../../src/app/api/services/resendService');
    await sendNewBuyerInterestEmail({
      agentEmail: 'agent@example.com',
      propertyAddress: '1 Example St',
      propertyId: 'prop-1',
      buyerName: 'Jane Buyer',
      buyerEmail: 'jane.buyer@example.com',
      buyerPhone: '0400 111 222',
      nextAction: 'contact',
    });

    const html = sentEmails[0].html;
    expect(html).toContain('href="mailto:jane.buyer@example.com"');
    expect(html).toContain('>jane.buyer@example.com<');
    expect(html).toContain('href="tel:0400111222"');
    expect(html).toContain('>0400 111 222<');
    // Never a partially-hidden address like "j***@example.com".
    expect(html).not.toMatch(/\*{2,}/);
  });

  it('presents buyer details and submitted answers as distinct, clearly-labelled cards', async () => {
    const { sendNewBuyerInterestEmail } = await import('../../src/app/api/services/resendService');
    await sendNewBuyerInterestEmail({
      agentEmail: 'agent@example.com',
      propertyAddress: '1 Example St',
      propertyId: 'prop-1',
      buyerName: 'Jane Buyer',
      buyerEmail: 'jane@example.com',
      nextAction: 'contact',
    });

    const html = sentEmails[0].html;
    expect(html.toLowerCase()).toContain('buyer details');
    expect(html.toLowerCase()).toContain('what the buyer told us');
    expect(html.toLowerCase()).toContain('next step');
  });

  it('never includes app-store promotion or an "unlock full details" gate', async () => {
    const { sendNewBuyerInterestEmail } = await import('../../src/app/api/services/resendService');
    await sendNewBuyerInterestEmail({
      agentEmail: 'agent@example.com',
      propertyAddress: '1 Example St',
      propertyId: 'prop-1',
      buyerName: 'Jane Buyer',
      nextAction: 'contact',
    });

    const html = sentEmails[0].html.toLowerCase();
    expect(html).not.toContain('app store');
    expect(html).not.toContain('google play');
    expect(html).not.toContain('unlock');
    expect(html).not.toContain('download');
  });

  it('subject line identifies the property clearly', async () => {
    const { sendNewBuyerInterestEmail } = await import('../../src/app/api/services/resendService');
    await sendNewBuyerInterestEmail({
      agentEmail: 'agent@example.com',
      propertyAddress: '7 Jingella Street, Hope Island',
      propertyId: 'prop-1',
      buyerName: 'Jane Buyer',
      nextAction: 'contact',
    });

    expect(sentEmails[0].subject).toBe('New buyer registration | 7 Jingella Street, Hope Island');
  });

  it('includes a readable plain-text fallback with the same key facts', async () => {
    const { sendNewBuyerInterestEmail } = await import('../../src/app/api/services/resendService');
    await sendNewBuyerInterestEmail({
      agentEmail: 'agent@example.com',
      propertyAddress: '1 Example St',
      propertyId: 'prop-xyz',
      buyerName: 'Jane Buyer',
      buyerEmail: 'jane@example.com',
      buyerPhone: '0400 111 222',
      nextAction: 'inspection',
      timeframe: 'asap',
    });

    const text = sentEmails[0].text;
    expect(text).toBeTruthy();
    expect(text).not.toContain('<');
    expect(text).toContain('Jane Buyer');
    expect(text).toContain('1 Example St');
    expect(text).toContain('jane@example.com');
    expect(text).toContain('0400 111 222');
    expect(text).toContain('Arrange an inspection');
    expect(text).toContain('/dashboard/property/prop-xyz');
  });

  it('plain-text section headings stay on blank-line-separated lines, never swallowed by the line-omission filter', async () => {
    // Regression guard: omitted-field lines and deliberate blank-line
    // separators both started as the same '' sentinel, so filtering out
    // missing fields once also stripped every section break.
    const { sendNewBuyerInterestEmail } = await import('../../src/app/api/services/resendService');
    await sendNewBuyerInterestEmail({
      agentEmail: 'agent@example.com',
      propertyAddress: '1 Example St',
      propertyId: 'prop-xyz',
      buyerName: 'Jane Buyer',
      nextAction: 'contact',
      // Deliberately no email/phone/timeframe/finance/buyer-type — the
      // minimum-information case, most likely to reveal the bug.
    });

    const lines = sentEmails[0].text.split('\n');
    expect(lines).toContain('BUYER DETAILS');
    expect(lines).toContain('WHAT THE BUYER TOLD US');
    expect(lines).toContain('NEXT STEP');
    const buyerDetailsIndex = lines.indexOf('BUYER DETAILS');
    const whatTheyToldUsIndex = lines.indexOf('WHAT THE BUYER TOLD US');
    expect(lines[whatTheyToldUsIndex - 1]).toBe('');
    expect(whatTheyToldUsIndex).toBeGreaterThan(buyerDetailsIndex);
  });
});
