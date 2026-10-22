import { describe, it, expect } from 'vitest';
import fs from 'node:fs';

// This project has no @testing-library/react / jsdom, so — matching the
// pattern already established elsewhere (register-interest-flow.test.js,
// property-redesign.test.js) — these tests cover the critical behaviour
// via source inspection rather than rendering the component.
//
// The backend lifecycle this component drives (propose/approve/reject,
// amendment vs initial confirmation, the active contact staying valid
// while a change is pending) is already fully covered at the service/
// route level in billing-service.test.js and
// billing-contact-confirmation.test.js. These tests exist purely to
// guard the WIRING in BillingDetailsSection.js itself — the exact
// endpoints it calls, and the display/prefill priority that keeps the
// previously-approved contact visibly active while a change is pending
// or rejected, per the explicit requirement that approved details are
// never overwritten or hidden until their replacement is approved.

function readSection() {
  return fs.readFileSync(
    new URL('../../src/app/dashboard/settings/BillingDetailsSection.js', import.meta.url),
    'utf-8'
  );
}

describe('BillingDetailsSection — Account Settings billing details', () => {
  it('reads status from the existing per-agent billing-contact-status endpoint — reuses the existing system, never a new one', () => {
    const source = readSection();
    expect(source).toContain("authFetch('/api/agency/billing-contact-status')");
  });

  it('submits changes through the existing propose-billing-contact endpoint — reuses the existing approval system', () => {
    const source = readSection();
    expect(source).toContain("authFetch('/api/agency/propose-billing-contact'");
    expect(source).toContain('billingName: formBillingName.trim()');
    expect(source).toContain('contactName: formContactName.trim()');
    expect(source).toContain('contactEmail: formContactEmail.trim()');
  });

  it('displays the CONFIRMED contact, not the proposed one, once the agent has been verified — the active contact never gets silently replaced by an in-flight proposal', () => {
    const source = readSection();
    const start = source.indexOf('const displayBillingName');
    const displayBlock = source.slice(start, source.indexOf('return (', start));
    expect(displayBlock).toContain("status === 'confirmed' ? billingName : proposedBillingName");
    expect(displayBlock).toContain("status === 'confirmed' ? contactName : proposedName");
    expect(displayBlock).toContain("status === 'confirmed' ? contactEmail : proposedEmail");
  });

  it('a pending or rejected amendment never overwrites the displayed confirmed values — it is shown as a separate notice', () => {
    const source = readSection();
    expect(source).toContain('hasPendingChange');
    expect(source).toContain('hasRejectedChange');
    // The notice strings reference changeRequest's own fields, not the
    // top-level confirmed ones — proof the two are rendered side by
    // side, never one overwriting the other.
    expect(source).toContain('changeRequest.proposedBillingName');
    expect(source).toContain('changeRequest.proposedEmail');
    expect(source).toContain('remain active until');
  });

  it('the Edit form, when a change is already pending, prefills from the PENDING change — not the stale confirmed values — so editing amends the in-flight request rather than starting over', () => {
    const source = readSection();
    const startEditBody = source.slice(source.indexOf('function startEdit'), source.indexOf('function cancelEdit'));
    expect(startEditBody).toMatch(/status === 'confirmed' && changeRequest/);
    expect(startEditBody).toContain('changeRequest.proposedBillingName');
  });

  it('a never-confirmed agent reuses the SAME form as the initial confirmation workflow — same endpoint, same fields, no separate code path', () => {
    const source = readSection();
    // Only one <form> / handleSubmit in the whole component — the
    // "initial confirmation" and "amendment" cases share the exact
    // same submit path, differing only in which branch
    // proposeBillingContact (server-side) takes.
    const formCount = (source.match(/<form/g) || []).length;
    expect(formCount).toBe(1);
  });

  it('requires a billing email before submitting', () => {
    const source = readSection();
    expect(source).toContain('formContactEmail.trim()');
    expect(source).toContain('A billing email address is required');
  });

  it('is gated to agents only in the Account Settings page', () => {
    const settingsSource = fs.readFileSync(
      new URL('../../src/app/dashboard/settings/page.js', import.meta.url),
      'utf-8'
    );
    expect(settingsSource).toContain('import BillingDetailsSection');
    const gateLine = settingsSource.split('\n').find((l) => l.includes('<BillingDetailsSection'));
    expect(gateLine).toMatch(/userData\?\.isAgent \|\| userData\?\.agent/);
  });
});
