import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const add = fs.readFileSync(path.join(process.cwd(), 'src/app/dashboard/add/page.js'), 'utf8');
const edit = fs.readFileSync(path.join(process.cwd(), 'src/app/dashboard/edit/[id]/page.js'), 'utf8');

describe('Add Property: eagerness question removed', () => {
  it('no longer asks, validates or stores an answer', () => {
    expect(add).not.toMatch(/eagernessOptions|setEagerness|Sales Timeline|How eager are you/);
    expect(add).not.toContain('STEPS.EAGERNESS');
    expect(add).toContain('isEager: null');
  });
  it('the Edit page no longer asks either, and never writes isEager (existing answers kept); readers left alone', () => {
    expect(edit).not.toContain('STEPS.EAGERNESS');
    expect(edit).not.toMatch(/How eager are you to sell|Sales Timeline|sales timeline/);
    expect(edit).not.toMatch(/isEager\s*:/);
    const helpers = fs.readFileSync(path.join(process.cwd(), 'src/app/api/v1/helpers.js'), 'utf8');
    expect(helpers).toMatch(/if \(val == null\) return false/);
    expect(helpers).toMatch(/if \(val == null\) return 0/);
  });
});

describe('Add Property: dashboard styling', () => {
  it('uses the warm-white, stone, orange-accent language with no gradients or old palette', () => {
    expect(add).toContain('bg-[#faf9f7]');
    expect(add).toContain('bg-[#e38100]');
    expect(add).not.toMatch(/c64500|a63a00/);
    expect(add).toContain('font-serif');
    expect(add).not.toMatch(/gradient|\bslate-|bg-orange-|rounded-2xl|rounded-xl|shadow-lg|shadow-sm/);
  });
});

describe('Add Property: preserved behaviour', () => {
  it('keeps pricing, terms acceptance, submission gating, charge recording and attribution', () => {
    expect(add).toContain('Premarket campaign fee — ${retail.price} AUD per campaign');
    expect(add).toContain('I have read and agree to the terms and conditions');
    expect(add).toContain('!termsAccepted || !pricingReady');
    expect(add).toContain('termsAcceptedAt: serverTimestamp()');
    expect(add).toContain('/record-charge');
    expect(add).toContain('userId: user.uid');
    expect(add).toContain("router.push('/dashboard?created=1')");
  });
  it('does not reintroduce removed features', () => {
    expect(add).not.toMatch(/Generate with AI|generate-listing|CLIENT_INFO|onEditImage|ai-edit/i);
  });
});

describe('Add Property: final refinements', () => {
  it('uses the logo orange (#e38100) for actions, selection, progress and focus', () => {
    expect(add).toContain('bg-[#e38100] hover:bg-[#cc7400]');
    expect(add).toContain('focus:border-[#e38100]');
    expect(add).toContain('accent-[#e38100]');
    expect(add).toContain('bg-[#e38100]"'); // progress fill
  });
  it('keeps both required choices on the type step with unchanged status values', () => {
    expect(add).toContain('Is this property on the market?');
    expect(add).toContain("value: 'premarket'");
    expect(add).toContain("value: 'on-market'");
    expect(add).toContain("useState('premarket')");
    expect(add).toContain('listingStatus,');
    expect(add).toContain("step === STEPS.TYPE && !type");
  });
  it('restricts address autocomplete to Australian street addresses', () => {
    expect(add).toContain("componentRestrictions: { country: 'au' }");
    expect(add).toContain("types: ['address']");
    expect(add).toContain('onPlaceChanged={handlePlaceChanged}');
  });
  it('has no corrupted utility classes from the palette swap', () => {
    expect(add).not.toMatch(/transtone|stone-ate/);
    expect(add).toContain('-translate-y-1/2');
  });
});
