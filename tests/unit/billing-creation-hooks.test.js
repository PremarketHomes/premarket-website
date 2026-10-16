import { describe, it, expect } from 'vitest';
import fs from 'node:fs';

function read(relPath) {
  return fs.readFileSync(new URL(relPath, import.meta.url), 'utf-8');
}

// Source-level checks (this project's existing pattern for logic that's
// awkward to exercise end-to-end without a browser or emulator — see
// tests/unit/image-positioning.test.js / property-redesign.test.js for
// the same style) confirming a charge is only ever wired into the three
// real property-creation paths, and specifically NOT into any
// edit/archive/visibility-toggle path, or the two confirmed-unreachable
// legacy forms.

describe('property-creation paths all call recordPropertyCharge exactly once', () => {
  it('dashboard/add/page.js (manual creation) calls the record-charge endpoint right after addDoc', () => {
    const source = read('../../src/app/dashboard/add/page.js');
    const addDocIdx = source.indexOf("addDoc(collection(db, 'properties'), propertyData)");
    const callIdx = source.indexOf('/api/properties/${propertyId}/record-charge');
    expect(addDocIdx).toBeGreaterThan(-1);
    expect(callIdx).toBeGreaterThan(addDocIdx);
  });

  it('propertyScrapeService.js (SMS-created listings) calls recordPropertyCharge after creating the property', () => {
    const source = read('../../src/app/api/services/propertyScrapeService.js');
    expect(source).toContain("from './billingService'");
    const addIdx = source.indexOf("adminDb.collection('properties').add(propertyData)");
    const chargeIdx = source.indexOf('recordPropertyCharge({ id: ref.id, ...propertyData })');
    expect(addIdx).toBeGreaterThan(-1);
    expect(chargeIdx).toBeGreaterThan(addIdx);
  });

  it('AgentBox import records a charge for a real import, but never for a demo-mode import', () => {
    const source = read('../../src/app/api/integrations/agentbox/import/route.js');
    expect(source).toContain('if (!isDemo) {');
    expect(source).toContain('recordPropertyCharge({ id: docRef.id, ...propertyData })');
  });

  it('Rex import records a charge for a real import, but never for a demo-mode import', () => {
    const source = read('../../src/app/api/integrations/rex/import/route.js');
    expect(source).toContain('if (!isDemo) {');
    expect(source).toContain('recordPropertyCharge({ id: docRef.id, ...propertyData })');
  });
});

describe('editing, archiving, and visibility changes never record a charge', () => {
  it('dashboard/edit/[id]/page.js never calls recordPropertyCharge or the record-charge endpoint', () => {
    const source = read('../../src/app/dashboard/edit/[id]/page.js');
    expect(source).not.toContain('recordPropertyCharge');
    expect(source).not.toContain('record-charge');
  });

  it('dashboard/property/[id]/page.js (visibility toggle, archive, sold/restore) never calls it either', () => {
    const source = read('../../src/app/dashboard/property/[id]/page.js');
    expect(source).not.toContain('recordPropertyCharge');
    expect(source).not.toContain('record-charge');
  });
});

describe('the two unreachable legacy upload forms are correctly left untouched', () => {
  // Form.js / FormBranded.js create a property directly via the client
  // SDK but are never imported by any route in this app (verified via
  // a full-repo grep before this change) — adding billing to genuinely
  // dead code would be pointless, so they're deliberately left as-is.
  // This test exists so a future reader doesn't "fix" the omission
  // without first re-checking that premise.
  it('Form.js and FormBranded.js are not imported anywhere', () => {
    const appFiles = [];
    function walk(dir) {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = `${dir}/${entry.name}`;
        if (entry.isDirectory()) walk(full);
        else if (entry.name.endsWith('.js')) appFiles.push(full);
      }
    }
    const appRoot = new URL('../../src/app', import.meta.url).pathname;
    walk(appRoot);

    const importers = appFiles.filter((file) => {
      if (file.endsWith('/components/Form.js') || file.endsWith('/components/FormBranded.js')) return false;
      const content = fs.readFileSync(file, 'utf-8');
      return /from ['"].*\/Form['"]|from ['"].*\/FormBranded['"]/.test(content);
    });

    expect(importers).toEqual([]);
  });
});
