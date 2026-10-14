import { describe, it, expect } from 'vitest';
import fs from 'node:fs';

function read(relPath) {
  return fs.readFileSync(new URL(relPath, import.meta.url), 'utf-8');
}

// Premarket moved away from public property discovery — properties are
// reached through their own shareable link now. These tests lock in that
// the promotional "Browse Properties" navigation entry points are gone
// from the site's primary nav/footer, while the underlying /listings and
// /v2 pages themselves are deliberately left in place (not deleted) so
// any existing bookmark or shared link still works.

describe('Nav.js — no "Browse Properties" entry point', () => {
  const source = read('../../src/app/components/Nav.js');

  it('desktop nav no longer links to /listings', () => {
    expect(source).not.toContain('>Browse<');
  });

  it('mobile menu no longer has a "Browse Properties" link', () => {
    expect(source).not.toContain('Browse Properties');
  });
});

describe('FooterLarge.js — no "Browse properties" link', () => {
  it('no longer links to /listings', () => {
    const source = read('../../src/app/components/FooterLarge.js');
    expect(source).not.toContain('Browse properties');
  });
});

describe('weekly newsletter — no "Browse All Properties" CTA', () => {
  it('ends with a signature instead of a directory-browsing button', () => {
    const source = read('../../src/app/api/services/newsletterService.js');
    expect(source).not.toContain('Browse All Properties');
    expect(source).toContain('signature()');
  });

  it('still links each featured property to its own direct, shareable link', () => {
    // The newsletter's core value (curated properties, each reachable via
    // its own link) is untouched — only the trailing directory-browse
    // button at the bottom was removed.
    const source = read('../../src/app/api/services/newsletterService.js');
    expect(source).toContain('/find-property?propertyId=');
  });
});

describe('register-interest confirmation — "Back to Property" instead of a dead browsing link', () => {
  const source = read('../../src/app/components/PropertyPageClient.js');

  it('no longer offers to browse more properties', () => {
    expect(source).not.toContain('Browse more properties');
  });

  it('offers "Back to Property" instead, closing the modal rather than navigating away', () => {
    const idx = source.indexOf('Back to Property');
    expect(idx).toBeGreaterThan(-1);
    const nearby = source.slice(Math.max(0, idx - 300), idx);
    expect(nearby).toContain('setShowSignupModal(false)');
    expect(nearby).not.toContain('href="/listings"');
  });

  it('reopening the modal after a completed registration shows the confirmation again, never the empty form', () => {
    // The X close button used to always reset showThankYou to false,
    // which meant a buyer who'd already registered and then reopened the
    // modal (e.g. by clicking the "already registered" link again) would
    // be shown the blank form a second time instead of their confirmed
    // registration.
    expect(source).not.toContain('setShowSignupModal(false);\n                setShowThankYou(false);');
  });
});
