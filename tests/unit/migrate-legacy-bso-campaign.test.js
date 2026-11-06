import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { planMigration, rollbackPatch, parseArgs, readOnly } = require('../../scripts/migrate-legacy-bso-campaign.js');

const agent = (first, last, extra = {}) => ({ firstName: first, lastName: last, agent: true, officeId: 'off1', accountStatus: 'active', ...extra });
const good = () => ({
  propertyId: 'P1',
  property: { userId: 'peta', agentId: 'roster1', agentName: 'Chantal Seller', agentAvatar: null, formattedAddress: '73 Test Ave', vendorUploaded: true },
  sellerUid: 'chantal', managerUid: 'peta',
  seller: agent('Chantal', 'Seller'), sellerAuth: { disabled: false, emailVerified: true, lastSignInTime: 'x' }, manager: agent('Peta', 'Bso'),
  office: { id: 'off1', name: 'Test', status: 'active', bsoUids: ['peta'], officeAdminUids: ['hannah'] },
  officeUsers: [{ uid: 'chantal', data: agent('Chantal', 'Seller') }, { uid: 'peta', data: agent('Peta', 'Bso') }],
  charge: { billingEntityKey: 'office:off1', status: 'pending', agentUserId: 'peta' },
});
const failing = (plan) => plan.checks.filter((c) => c.blocking && !c.ok).map((c) => c.name);

describe('planMigration (Riverwalk-shaped record)', () => {
  it('a clean record is ready, and the write moves only ownership, management, creator and the roster override', () => {
    const plan = planMigration(good());
    expect(failing(plan)).toEqual([]);
    expect(plan.ok).toBe(true);
    expect(plan.before).toEqual({ userId: 'peta', agentId: 'roster1', agentName: 'Chantal Seller', agentAvatar: null, managedByUid: null, createdByUid: null, createdByRole: null });
    expect(plan.after).toEqual({ userId: 'chantal', agentId: null, agentName: null, agentAvatar: null, managedByUid: 'peta', createdByUid: 'peta', createdByRole: 'bso' });
  });
  it('refuses if the BSO does not hold the BSO role yet (the migration would remove their access)', () => {
    const s = good(); s.office.bsoUids = [];
    expect(failing(planMigration(s))).toEqual(['BSO currently holds the BSO role in the office (otherwise the migration would remove their access)']);
  });
  it('refuses an ambiguous or different roster match, exactly like the public page would', () => {
    const s = good(); s.officeUsers.push({ uid: 'chantal2', data: agent('Chantal', 'Seller') });
    expect(failing(planMigration(s))).toContain('roster name resolves to exactly one office agent, and it is the selling agent given');
    const t = good(); t.sellerUid = 'peta';
    expect(planMigration(t).ok).toBe(false);
  });
  it('refuses already-migrated, office-created, re-owned, suspended or Auth-less records', () => {
    for (const mutate of [
      (s) => { s.property.managedByUid = 'peta'; }, (s) => { s.property.managedCreation = true; }, (s) => { s.property.userId = 'someone'; },
      (s) => { s.seller.accountStatus = 'suspended'; }, (s) => { s.sellerAuth = null; }, (s) => { s.sellerAuth.disabled = true; },
      (s) => { s.office.status = 'suspended'; }, (s) => { s.seller.officeId = 'off2'; }, (s) => { s.property = null; },
    ]) { const s = good(); mutate(s); expect(planMigration(s).ok).toBe(false); }
  });
  it('a charge on a different entity is reported (non-blocking note); billing is never written', () => {
    const s = good(); s.charge.billingEntityKey = 'agent:peta';
    const plan = planMigration(s);
    expect(plan.ok).toBe(true);
    expect(plan.checks.find((c) => /billing/.test(c.name))).toMatchObject({ ok: false, blocking: false });
    expect(Object.keys(plan.after)).not.toContain('billingEntityKey');
  });
});

describe('buyer-page identity comparison (reported, never blocking)', () => {
  const pub = (extra = {}) => ({ name: 'Chantal Seller', avatar: 'https://cdn/x.jpg', phone: true, companyName: 'HPH', officeId: 'off1', brandColors: true, logoUrl: false, ...extra });
  it('passes when agency identity matches and the selling agent has a name', () => {
    const plan = planMigration({ ...good(), sellerPublic: pub(), managerPublic: pub({ name: 'Peta Bso' }) });
    expect(plan.checks.filter((c) => /buyer page/.test(c.name)).every((c) => c.ok && !c.blocking)).toBe(true);
  });
  it('flags a different company name or a placeholder photo without blocking', () => {
    const plan = planMigration({ ...good(), sellerPublic: pub({ companyName: 'Other', avatar: 'https://upload.wikimedia.org/Profile_avatar_placeholder_large.png' }), managerPublic: pub() });
    const agency = plan.checks.find((c) => /agency identity/.test(c.name));
    expect(agency).toMatchObject({ ok: false, blocking: false });
    expect(plan.checks.find((c) => /own name, photo/.test(c.name)).detail).toMatch(/placeholder/);
    expect(plan.ok).toBe(true);
  });
});

describe('rollback and safety rails', () => {
  it('rollback restores every saved value and deletes the fields that did not exist before', () => {
    const DEL = { __delete: true };
    expect(rollbackPatch(planMigration(good()).before, DEL)).toEqual({ userId: 'peta', agentId: 'roster1', agentName: 'Chantal Seller', agentAvatar: null, managedByUid: DEL, createdByUid: DEL, createdByRole: DEL });
  });
  it('the dry-run wrapper throws on any write', async () => {
    const fake = { collection: () => ({ doc: () => ({ get: async () => ({}), update: async () => {}, set: async () => {} }) }), runTransaction: async () => {} };
    const ro = readOnly(fake);
    expect(() => ro.runTransaction(() => {})).toThrow(/read-only/);
    expect(() => ro.collection('properties').doc('x').update({})).toThrow(/read-only/);
    await expect(ro.collection('properties').doc('x').get()).resolves.toEqual({});
  });
  it('parses arguments and rejects unknown ones', () => {
    expect(parseArgs(['--property', 'P', '--selling-agent', 'c', '--manager', 'p'])).toMatchObject({ property: 'P', seller: 'c', manager: 'p', execute: false });
    expect(() => parseArgs(['--force'])).toThrow();
  });
});
