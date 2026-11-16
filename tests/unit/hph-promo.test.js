import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { PROMOTIONS, PROMO_MESSAGES, HPH_OFFICE_ID, resolvePromotion, normalizePromoCode, eligibleOfficeIds, redemptionIdFor } from '../../src/app/api/services/promotions';

const promo = PROMOTIONS.HPHNOVEMBER;
const read = (p) => readFileSync(p, 'utf8');

describe('HPHNOVEMBER rules', () => {
  it('ends at 30 Nov 2026 00:00 Australia/Brisbane (UTC+10, no daylight saving) = 2026-11-29T14:00:00Z', () => {
    expect(promo.endsAtMs).toBe(Date.UTC(2026, 10, 29, 14, 0, 0));
    expect(resolvePromotion('HPHNOVEMBER', Date.parse('2026-11-29T23:59:59.999+10:00')).code).toBe('HPHNOVEMBER');
    expect(() => resolvePromotion('HPHNOVEMBER', Date.parse('2026-11-30T00:00:00+10:00'))).toThrow(PROMO_MESSAGES.expired(promo));
  });
  it('is case- and space-insensitive; anything else is invalid', () => {
    expect(normalizePromoCode('  hphNovember ')).toBe('HPHNOVEMBER');
    expect(() => resolvePromotion('HPH NOVEMBER', 0)).toThrow(PROMO_MESSAGES.invalid);
    expect(() => resolvePromotion('', 0)).toThrow(PROMO_MESSAGES.invalid);
  });
  it('only the Harcourts Property Hub office is eligible in production; a test office is ignored when the server is live', () => {
    expect(HPH_OFFICE_ID).toBe('ioxigzf4hcRtowqL4C94');
    expect(eligibleOfficeIds(promo, {})).toEqual([HPH_OFFICE_ID]); // no credentials = live project
    expect(eligibleOfficeIds(promo, { PROMO_TEST_OFFICE_ID: 'x', FIREBASE_SERVICE_ACCOUNT: JSON.stringify({ project_id: 'premarket-homes' }) })).toEqual([HPH_OFFICE_ID]);
    expect(eligibleOfficeIds(promo, { PROMO_TEST_OFFICE_ID: 'stg', FIREBASE_SERVICE_ACCOUNT: JSON.stringify({ project_id: 'premarket-ows-staging-dbf1' }) })).toEqual([HPH_OFFICE_ID, 'stg']);
  });
  it('one redemption id per code + selling agent (the uploader plays no part)', () => {
    expect(redemptionIdFor('HPHNOVEMBER', 'phil')).toBe('HPHNOVEMBER_phil');
  });
  it('uses the agreed wording, with no $ figures, GST or invoice wording (shown to retail-price HPH agents)', () => {
    expect(PROMO_MESSAGES.applied('HPHNOVEMBER')).toBe('HPHNOVEMBER applied — this agent’s first Premarket campaign is FREE.');
    expect(PROMO_MESSAGES.alreadyRedeemed).toBe('This agent has already used their free November campaign.');
    for (const m of [PROMO_MESSAGES.applied('HPHNOVEMBER'), PROMO_MESSAGES.alreadyRedeemed, PROMO_MESSAGES.invalid, PROMO_MESSAGES.expired(promo), PROMO_MESSAGES.notEligible]) {
      expect(m).not.toMatch(/\$\s?\d|GST|invoice/i);
    }
  });
});

describe('Add Property page wiring', () => {
  const add = read('src/app/dashboard/add/page.js');
  it('shows an optional promo code field under the terms, checked on Apply for the selling agent', () => {
    expect(add).toContain('Promo Code <span className="font-normal text-stone-500">(optional)</span>');
    expect(add).toContain("authFetch('/api/promo/check'");
    expect(add).toContain('JSON.stringify({ code, ownerUid: ownerUid || null })');
    expect(add).toContain('Free campaign for <strong>{promo.agentName}</strong>, the selling agent.');
  });
  it('managed (office admin / BSO) creation sends the code; the server redeems it for the selling agent', () => {
    expect(add).toContain("...(promoApplied && !testCampaign ? { promoCode: promo.code } : {}),");
  });
  it("an agent's own promo campaign is created by the server (idempotent requestId); without a code the existing flow is unchanged", () => {
    expect(add).toContain("authFetch('/api/properties/promo-create'");
    expect(add).toContain('requestId: ownPromoRequestId.current');
    expect(add).toContain("const docRef = await addDoc(collection(db, 'properties'), propertyData);");
    expect(add).toContain("authFetch(`/api/properties/${propertyId}/record-charge`, { method: 'POST' })");
  });
  it('changing the selling agent or ticking Test campaign clears an applied code; the fee shows FREE while applied', () => {
    expect(add).toContain('useEffect(() => { setPromo(PROMO_IDLE); ownPromoRequestId.current = null; }, [ownerUid]);');
    expect(add).toContain('if (e.target.checked) clearPromo();');
    expect(add).toContain('Premarket campaign fee — FREE ({promo.code})');
    expect(add).toContain("step === STEPS.TERMS && !promoApplied && !retailFailed && retail.state === 'retail'");
  });
  it('the agent promo route is blocked on live-backed previews like the other write routes', () => {
    expect(read('src/app/api/services/environmentGuard.js')).toContain('/^\\/api\\/properties\\/promo-create$/');
  });
});
