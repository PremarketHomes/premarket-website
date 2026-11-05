import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
const read = (p) => readFileSync(p, 'utf8');

describe('My Team entry points', () => {
  it('wait for the signed-in user before asking the server who may create campaigns (a mount-time call silently never fires)', () => {
    const page = read('src/app/dashboard/team/page.js');
    const effect = page.slice(page.indexOf("authFetch('/api/properties/managed/agents')") - 120, page.indexOf("}, [user]);"));
    expect(effect).toContain('if (!user) return');
    expect(page).toContain('}, [user]);');
  });
});

describe('Add Property is extended, not duplicated', () => {
  const add = read('src/app/dashboard/add/page.js');
  it('the existing agent-led path is intact', () => {
    expect(add).toContain("addDoc(collection(db, 'properties'), propertyData)");
    expect(add).toContain('userId: user.uid');
    expect(add).toContain('/record-charge');
    expect(add).toContain('uploadMediaInBackground(propertyId, user.uid');
  });
  it('the agent selector only appears when the server says the user may create for others', () => {
    expect(add).toContain('assignable.agents.length > 0');
    expect(add).toContain("authFetch('/api/properties/managed/agents')");
    expect(add).toContain('Who is this campaign for?');
  });
  it('managed submit goes through the server with an idempotency key and never writes properties from the browser', () => {
    const managed = add.slice(add.indexOf('if (ownerUid) {'), add.indexOf('try {\n      setIsSubmitting(true);\n\n      // Separate pre-existing'));
    expect(managed).toContain("'/api/properties/managed'");
    expect(managed).toContain('requestId: managedRequestId.current');
    expect(managed).not.toContain("collection(db, 'properties')");
    expect(managed).not.toContain('record-charge'); // billing is recorded server-side, once
  });
  it('there is no separate campaign system: no second properties collection or add page', () => {
    expect(read('src/app/api/services/managedCampaignService.js')).toContain("collection('properties')");
    expect(read('src/app/api/services/managedCampaignService.js')).not.toMatch(/collection\('(officeCampaigns|managedProperties|campaigns)'\)/);
  });
});
