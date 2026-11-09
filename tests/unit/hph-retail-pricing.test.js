import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const store = {};
vi.mock('../../src/app/firebase/adminApp', () => ({
  adminDb: {
    collection: (name) => ({
      doc: (id) => ({
        async get() {
          const data = store[name]?.[id];
          return { exists: !!data, data: () => data };
        },
      }),
    }),
  },
}));

const verifyAuth = vi.fn();
vi.mock('../../src/app/api/middleware/auth', () => ({ verifyAuth: (...a) => verifyAuth(...a) }));

const seed = (n, id, d) => { store[n] = store[n] || {}; store[n][id] = d; };

const BASE_TERMS = [
  '1. Introduction\nPremarket Group Pty Ltd provides the platform.',
  '6. Payment Terms\nCampaign Fee: the submitting agent\'s agency agrees to pay Premarket Group Pty Ltd a fee of $200 AUD. Premarket Group Pty Ltd is not currently registered for GST, so no GST is charged on this fee.\nBilling Cycle: Premarket issues one consolidated, itemised invoice per agency.\nLate Payment: Premarket reserves the right to suspend access.',
  '7. Disclaimers and Limitations of Liability\nNo Warranty.',
].join('\n\n');

const read = (p) => fs.readFileSync(path.join(process.cwd(), p), 'utf8');

beforeEach(() => {
  for (const k of Object.keys(store)) delete store[k];
  vi.clearAllMocks();
  seed('settings', 'invoicing', { pricePerListing: 200, gstRate: 0, paymentTermsDays: 14 });
  seed('settings', 'addPropertyTermsAgent', { body: BASE_TERMS });
  seed('officeAdminInfo', 'hph', { name: 'HPH', status: 'active', retailCampaignPrice: 349 });
  seed('officeAdminInfo', 'other', { name: 'Other', status: 'active' });
  seed('users', 'phil', { officeId: 'hph' });
  seed('users', 'otherAgent', { officeId: 'other' });
  seed('users', 'solo', {});
});

describe('GET /api/agents/campaign-pricing', () => {
  async function call(uid) {
    verifyAuth.mockResolvedValue(uid ? { authenticated: true, uid } : { authenticated: false, error: 'Missing', status: 401 });
    const { GET } = await import('../../src/app/api/agents/campaign-pricing/route.js');
    const res = await GET(new Request('http://x/api/agents/campaign-pricing'));
    return { status: res.status, body: await res.json() };
  }

  it('requires sign-in', async () => {
    expect((await call(null)).status).toBe(401);
  });

  it('HPH agents get $349 and retail terms, with no wholesale, margin or GST wording', async () => {
    const { status, body } = await call('phil');
    expect(status).toBe(200);
    expect(body.retail).toBe(true);
    expect(body.price).toBe(349);
    const all = JSON.stringify(body);
    expect(all).toContain('$349 AUD per campaign');
    expect(all).toContain('payable by the vendor (Seller) through the agent');
    expect(all).not.toMatch(/\$\s?200|\b200\b|\b149\b|GST|invoice/i);
    expect(body.terms).toContain('6. Payment Terms');
    expect(body.terms).toContain('7. Disclaimers');
    expect(body.terms).toContain('1. Introduction');
  });

  it('other offices and independent agents are unchanged (standard flow)', async () => {
    expect((await call('otherAgent')).body).toEqual({ retail: false });
    expect((await call('solo')).body).toEqual({ retail: false });
  });

  it('an inactive office or invalid price falls back to the standard flow', async () => {
    seed('officeAdminInfo', 'hph', { name: 'HPH', status: 'suspended', retailCampaignPrice: 349 });
    expect((await call('phil')).body).toEqual({ retail: false });
    seed('officeAdminInfo', 'hph', { name: 'HPH', status: 'active', retailCampaignPrice: '349' });
    expect((await call('phil')).body).toEqual({ retail: false });
  });

  it('fails closed (500) if the base terms layout changes, rather than serving wrong text', async () => {
    seed('settings', 'addPropertyTermsAgent', { body: '1. Intro\nNo payment section.' });
    expect((await call('phil')).status).toBe(500);
  });

  it('works with the stored literal "\\n" newline format', async () => {
    seed('settings', 'addPropertyTermsAgent', { body: BASE_TERMS.replace(/\n/g, '\\n') });
    const { body } = await call('phil');
    expect(body.retail).toBe(true);
    expect(body.terms).not.toMatch(/\$200|GST|invoice/i);
  });
});

describe('wholesale billing and the existing endpoint are untouched', () => {
  it('the public pricing endpoint still returns the wholesale-configured figures', async () => {
    vi.resetModules();
    const { GET } = await import('../../src/app/api/public/pricing-info/route.js');
    const data = await (await GET()).json();
    expect(data).toEqual({ pricePerListing: 200, gstRate: 0, paymentTermsDays: 14 });
  });

  it('billing code never reads the retail field, and the retail service never reads settings/invoicing', () => {
    expect(read('src/app/api/services/billingService.js')).not.toMatch(/retailCampaignPrice|campaignPricingService/);
    expect(read('src/app/api/services/invoiceRunService.js')).not.toMatch(/retailCampaignPrice/);
    const svc = read('src/app/api/services/campaignPricingService.js').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    expect(svc).not.toMatch(/doc\(['"]invoicing['"]\)|billingService|DEFAULT_PRICE/);
  });
});

describe('upload page and dashboard banner', () => {
  const add = read('src/app/dashboard/add/page.js');

  it('shows the exact HPH confirmation wording and no GST wording in the retail branch', () => {
    expect(add).toContain('Premarket campaign fee — ${retail.price} AUD per campaign');
    const retailBlock = add.slice(add.indexOf("retail.state === 'retail' && ("), add.indexOf("retail.state === 'unknown' && ("));
    expect(retailBlock).not.toMatch(/GST|\$200|invoice/i);
  });

  it('standard price only renders when the office check resolved to none; submit stays gated and the checkbox remains', () => {
    expect(add).toContain("retail.state === 'none' && (");
    expect(add).toContain('!pricingReady');
    expect(add).toContain('I have read and agree to the terms and conditions');
    expect(add).toContain('termsAcceptedAt: serverTimestamp()');
  });

  it('the retired "Billing Is Now Active" $200 banner is gone for everyone (no flash while user data loads)', () => {
    const dash = read('src/app/dashboard/page.js');
    expect(dash).not.toContain('BillingAnnouncementBanner');
    expect(dash).not.toContain('Billing Is Now Active');
    expect(dash).not.toContain('$200 campaign fee');
  });
});
