import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
const read = (p) => readFileSync(p, 'utf8');

describe('My Team entry points (Team Admin retired)', () => {
  it('My Team offers no create-for-a-teammate or team registrations link, and shows no Team Admin/Creator badge', () => {
    const page = read('src/app/dashboard/team/page.js');
    expect(page).not.toContain("authFetch('/api/properties/managed/agents')");
    expect(page).not.toMatch(/Create a campaign for a teammate|View team registrations|canCreateForTeam/);
    expect(page).not.toMatch(/>Creator<|Team admin/i);
    // The existing remove-teammate control stays until the office-admin replacement is verified (server decides canRemove).
    expect(page).toContain('m.canRemove');
  });
  it('Office > Teams has no Team Admin badge or role selection', () => {
    const page = read('src/app/dashboard/office/teams/page.js');
    expect(page).not.toMatch(/Team admin|Team administrator|Make team admin|Crown/);
  });
});

describe('Add Property is extended, not duplicated', () => {
  const add = read('src/app/dashboard/add/page.js');
  it('the existing agent-led path is intact', () => {
    expect(add).toContain("addDoc(collection(db, 'properties'), propertyData)");
    expect(add).toContain('userId: user.uid');
    expect(add).toContain('/record-charge');
    expect(add).toContain('enqueuePropertyUpload({ propertyId, userId: user.uid');
  });
  it('the agent selector only appears when the server says the user may create for others', () => {
    expect(add).toContain('assignable.agents.length > 0');
    expect(add).toContain("authFetch('/api/properties/managed/agents')");
    expect(add).toContain('Selling agent');
    // BSOs must choose a selling agent (no "Myself"); office admins may hand management to a BSO.
    expect(add).toContain("isBsoCreator ? 'Choose the selling agent…' : 'Myself'");
    expect(add).toContain("Choose the selling agent for this campaign.");
    expect(add).toContain("managerUid: assignable.role === 'officeAdmin' ? (managerUid || null) : null");
  });
  it('managed submit goes through the server with an idempotency key and never writes properties from the browser', () => {
    const managed = add.slice(add.indexOf('if (ownerUid) {'), add.indexOf('try {\n      setIsSubmitting(true);\n\n      // Separate pre-existing'));
    // The photos upload, then the campaign is created, by the background upload manager (same endpoint, same idempotent requestId).
    expect(managed).toContain('enqueueManagedCreate(');
    expect(managed).toContain('requestId: managedRequestId.current');
    expect(read('src/app/utils/mediaUploadManager.js')).toContain("'/api/properties/managed'");
    expect(read('src/app/utils/mediaUploadManager.js')).toContain('requestId: job.requestId');
    expect(managed).not.toContain("collection(db, 'properties')");
    expect(managed).not.toContain('record-charge'); // billing is recorded server-side, once
  });
  it('there is no separate campaign system: no second properties collection or add page', () => {
    expect(read('src/app/api/services/managedCampaignService.js')).toContain("collection('properties')");
    expect(read('src/app/api/services/managedCampaignService.js')).not.toMatch(/collection\('(officeCampaigns|managedProperties|campaigns)'\)/);
  });
});
