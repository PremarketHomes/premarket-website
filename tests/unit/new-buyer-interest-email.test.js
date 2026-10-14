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

  it('omits the optional-details block entirely when nothing optional was collected', async () => {
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
    expect(html).not.toContain('Buying timeframe');
    expect(html).not.toContain('Finance:');
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
});
