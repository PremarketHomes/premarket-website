import { describe, it, expect } from 'vitest';
import fs from 'node:fs';

// This project has no @testing-library/react / jsdom, so — matching the
// pattern already established elsewhere (property-redesign.test.js,
// agent-contact-presentation.test.js) — these tests cover the critical
// behaviour via source inspection rather than rendering the component.

function readPropertyPageClient() {
  return fs.readFileSync(
    new URL('../../src/app/components/PropertyPageClient.js', import.meta.url),
    'utf-8'
  );
}

describe('registering interest always creates a genuine lead', () => {
  it('handleContactSubmit has an addDoc fallback, not just updateDoc gated behind a prior offer', () => {
    // The bug this guards against: handleContactSubmit used to only ever
    // call updateDoc(doc(db, 'offers', savedOfferId), ...) inside an
    // `if (savedOfferId)` check, with no else branch. A buyer who clicked
    // "Register formal interest" without ever submitting a price opinion
    // first (savedOfferId null) would see "You're all set" while nothing
    // was written to Firestore at all — a silently lost lead with no
    // error, no retry, and nothing for the agent to ever see.
    const source = readPropertyPageClient();
    const fnStart = source.indexOf('const handleContactSubmit');
    expect(fnStart).toBeGreaterThan(-1);
    const fnEnd = source.indexOf('\n  const handleRegisterInterest', fnStart);
    const fnBody = source.slice(fnStart, fnEnd > -1 ? fnEnd : fnStart + 4000);

    expect(fnBody).toContain('updateDoc(doc(db, \'offers\', savedOfferId)');
    expect(fnBody).toContain('addDoc(collection(db, \'offers\')');
  });

  it('handleContactSubmit never fabricates an offerAmount for a visitor who never gave a real opinion', () => {
    const source = readPropertyPageClient();
    const fnStart = source.indexOf('const handleContactSubmit');
    const fnEnd = source.indexOf('\n  const handleRegisterInterest', fnStart);
    const fnBody = source.slice(fnStart, fnEnd);

    expect(fnBody).toContain('hasInteracted ? { offerAmount: Math.round(priceOpinion) } : {}');
  });

  it('handleContactSubmit is gated by isPreviewDeployment, like the price-opinion write path', () => {
    const source = readPropertyPageClient();
    const fnStart = source.indexOf('const handleContactSubmit');
    const fnEnd = source.indexOf('\n  const handleRegisterInterest', fnStart);
    const fnBody = source.slice(fnStart, fnEnd);

    expect(fnBody).toContain('isPreviewDeployment()');
  });

  it('handleRegisterInterest skips straight to the contact form — no separate qualification gate first', () => {
    const source = readPropertyPageClient();
    const fnStart = source.indexOf('const handleRegisterInterest');
    expect(fnStart).toBeGreaterThan(-1);
    const fnBody = source.slice(fnStart, fnStart + 500);

    expect(fnBody).toContain('setShowSignupModal(true)');
    expect(fnBody).not.toContain('setShowQualificationModal(true)');
  });

  it('a successful registration notifies the agent, without blocking the buyer confirmation on it', () => {
    const source = readPropertyPageClient();
    expect(source).toContain("fetch('/api/offers/notify-interest'");
    // Fire-and-forget: the notify call's own failure must never reach the
    // buyer-facing catch block that shows a retry error.
    expect(source).toContain("}).catch((err) => console.error('Error notifying agent of new interest:', err));");
  });

  it('the old mandatory finance/seriousness qualification screen is gone from the web flow', () => {
    // "Select your interest level" / "Tell us a little more" legitimately
    // still exist for iPad kiosk mode (its own, separate, untouched modal
    // earlier in the file) — scope this to the web Register Interest
    // modal specifically, not the whole file.
    const source = readPropertyPageClient();
    const webModalStart = source.indexOf('Register Interest Modal — a single screen');
    expect(webModalStart).toBeGreaterThan(-1);
    const webModalBody = source.slice(webModalStart, webModalStart + 6000);

    expect(webModalBody).not.toContain('Select your interest level');
    expect(webModalBody).not.toContain('This helps the agent understand your circumstances.');
    expect(webModalBody).not.toContain('Finance status');
  });

  it('the new next-action question always has a usable default and is never a submit-blocking field', () => {
    const source = readPropertyPageClient();
    expect(source).toContain("nextAction: 'contact'");
    expect(source).toContain('What would you like next?');
  });
});

describe('agent notification email', () => {
  function readResendService() {
    return fs.readFileSync(
      new URL('../../src/app/api/services/resendService.js', import.meta.url),
      'utf-8'
    );
  }

  it('exports sendNewBuyerInterestEmail', () => {
    const source = readResendService();
    expect(source).toContain('export async function sendNewBuyerInterestEmail');
  });

  it('never claims a buyer registered an offer or a commitment to buy', () => {
    const source = readResendService();
    const fnStart = source.indexOf('export async function sendNewBuyerInterestEmail');
    const fnEnd = source.indexOf('\nexport', fnStart + 10);
    const fnBody = source.slice(fnStart, fnEnd > -1 ? fnEnd : fnStart + 2000).toLowerCase();
    expect(fnBody).not.toContain('offer to purchase');
    expect(fnBody).not.toContain('made an offer');
  });
});

describe('notify-interest API route', () => {
  it('reads via the Admin SDK and never trusts a client-supplied agent email', () => {
    const source = fs.readFileSync(
      new URL('../../src/app/api/offers/notify-interest/route.js', import.meta.url),
      'utf-8'
    );
    expect(source).toContain("import { adminDb } from '../../../firebase/adminApp'");
    expect(source).toContain('sendNewBuyerInterestEmail');
    // The route resolves the agent's email itself from the property's
    // owning user doc — it must never read an agent email out of the
    // request body.
    expect(source).not.toMatch(/agentEmail\s*[,}]\s*=\s*await req\.json/);
  });
});
