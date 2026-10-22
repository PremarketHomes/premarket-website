import { describe, it, beforeAll, afterAll, beforeEach } from 'vitest';
import {
  getTestEnv, getAuthedDb, getUnauthDb, getSuperAdminDb, seedDoc,
  cleanup, teardown,
  assertSucceeds, assertFails,
  doc, getDoc, setDoc, updateDoc, deleteDoc,
} from './helpers.js';

beforeAll(async () => { await getTestEnv(); });
afterAll(async () => { await teardown(); });
beforeEach(async () => { await cleanup(); });

describe('users collection', () => {
  // --- read ---
  it('allows unauthenticated read', async () => {
    const ownerDb = getAuthedDb('user1');
    await setDoc(doc(ownerDb, 'users', 'user1'), { name: 'Alice' });
    const db = getUnauthDb();
    await assertSucceeds(getDoc(doc(db, 'users', 'user1')));
  });

  it('allows authenticated read of own doc', async () => {
    const db = getAuthedDb('user1');
    await setDoc(doc(db, 'users', 'user1'), { name: 'Alice' });
    await assertSucceeds(getDoc(doc(db, 'users', 'user1')));
  });

  it('allows authenticated read of another user', async () => {
    const ownerDb = getAuthedDb('user1');
    await setDoc(doc(ownerDb, 'users', 'user1'), { name: 'Alice' });
    const db = getAuthedDb('user2');
    await assertSucceeds(getDoc(doc(db, 'users', 'user1')));
  });

  // --- create ---
  it('allows create of own user doc', async () => {
    const db = getAuthedDb('user1');
    await assertSucceeds(setDoc(doc(db, 'users', 'user1'), { name: 'Alice' }));
  });

  it('denies create of another user doc', async () => {
    const db = getAuthedDb('user2');
    await assertFails(setDoc(doc(db, 'users', 'user1'), { name: 'Alice' }));
  });

  it('denies unauthenticated create', async () => {
    const db = getUnauthDb();
    await assertFails(setDoc(doc(db, 'users', 'user1'), { name: 'Alice' }));
  });

  // --- update ---
  // `firstName` (a real, legitimately self-editable field — see
  // dashboard/settings/page.js) rather than the placeholder `name` used
  // elsewhere in this file: the update rule is now an allowlist of real
  // field names, not a denylist, so a made-up field would pass for the
  // wrong reason (it's simply not one of the denied ones) rather than
  // actually proving a real self-service field still works.
  it('allows update of own user doc using a real self-editable field', async () => {
    const db = getAuthedDb('user1');
    await setDoc(doc(db, 'users', 'user1'), { firstName: 'Alice' });
    await assertSucceeds(updateDoc(doc(db, 'users', 'user1'), { firstName: 'Bob' }));
  });

  it('allows every field dashboard/settings and dashboard pages actually write to a user\'s own doc', async () => {
    const db = getAuthedDb('user1');
    await setDoc(doc(db, 'users', 'user1'), { firstName: 'Alice' });
    await assertSucceeds(updateDoc(doc(db, 'users', 'user1'), {
      firstName: 'Alice', lastName: 'Lee', roles: ['agent'], avatar: 'https://example.com/a.png',
      logoUrl: 'https://example.com/logo.png', companyName: 'Acme Realty',
      phone: '+61400000000', mobileConfirmedAt: new Date(),
    }));
  });

  it('denies update of another user doc', async () => {
    const ownerDb = getAuthedDb('user1');
    await setDoc(doc(ownerDb, 'users', 'user1'), { firstName: 'Alice' });
    const db = getAuthedDb('user2');
    await assertFails(updateDoc(doc(db, 'users', 'user1'), { firstName: 'Hacker' }));
  });

  it('denies unauthenticated update', async () => {
    const ownerDb = getAuthedDb('user1');
    await setDoc(doc(ownerDb, 'users', 'user1'), { firstName: 'Alice' });
    const db = getUnauthDb();
    await assertFails(updateDoc(doc(db, 'users', 'user1'), { firstName: 'Hacker' }));
  });

  // --- agencyBrandId (agency branding) ---
  // Only the server (Admin SDK, via /api/branding/confirm) may set this —
  // never the client, even the account owner — so an agent can't
  // self-assign another agency's brand (logo/colours) onto their own
  // public campaigns.
  it('denies the owner setting their own agencyBrandId directly', async () => {
    const db = getAuthedDb('user1');
    await setDoc(doc(db, 'users', 'user1'), { firstName: 'Alice' });
    await assertFails(updateDoc(doc(db, 'users', 'user1'), { agencyBrandId: 'harcourts-property-hub' }));
  });

  it('denies changing agencyBrandId even alongside an otherwise-valid field', async () => {
    const db = getAuthedDb('user1');
    await setDoc(doc(db, 'users', 'user1'), { firstName: 'Alice' });
    await assertFails(updateDoc(doc(db, 'users', 'user1'), { firstName: 'Bob', agencyBrandId: 'someone-elses-brand' }));
  });

  it('still allows updating unrelated fields when agencyBrandId is untouched', async () => {
    const db = getAuthedDb('user1');
    await setDoc(doc(db, 'users', 'user1'), { firstName: 'Alice', agencyBrandId: 'existing-brand' });
    await assertSucceeds(updateDoc(doc(db, 'users', 'user1'), { firstName: 'Bob' }));
  });

  // --- brandColors (personal branding override) ---
  // Same reasoning as agencyBrandId above: colour validation/contrast
  // (buildColorSet) must always happen server-side, via
  // /api/branding/confirm — never a direct client write, even by the
  // account owner, which could otherwise bypass that validation.
  it('denies the owner setting their own brandColors directly', async () => {
    const db = getAuthedDb('user1');
    await setDoc(doc(db, 'users', 'user1'), { firstName: 'Alice' });
    await assertFails(updateDoc(doc(db, 'users', 'user1'), { brandColors: { primary: '#ff0000' } }));
  });

  it('denies changing brandColors even alongside an otherwise-valid field', async () => {
    const db = getAuthedDb('user1');
    await setDoc(doc(db, 'users', 'user1'), { firstName: 'Alice' });
    await assertFails(updateDoc(doc(db, 'users', 'user1'), { firstName: 'Bob', brandColors: { primary: '#ff0000' } }));
  });

  it('still allows updating unrelated fields when brandColors is untouched', async () => {
    const db = getAuthedDb('user1');
    await setDoc(doc(db, 'users', 'user1'), { firstName: 'Alice', brandColors: { primary: '#ff0000' } });
    await assertSucceeds(updateDoc(doc(db, 'users', 'user1'), { firstName: 'Bob' }));
  });

  // --- officeId / isOfficeAdmin (office membership) ---
  // Only the server (Admin SDK, via /api/offices and /api/office-invites)
  // may set these — never the client directly, or an agent could
  // self-assign membership of any office (and its branding) just by
  // writing officeId onto their own account, or grant themselves
  // administrator rights over an office with isOfficeAdmin.
  it('denies the owner setting their own officeId directly', async () => {
    const db = getAuthedDb('user1');
    await setDoc(doc(db, 'users', 'user1'), { firstName: 'Alice' });
    await assertFails(updateDoc(doc(db, 'users', 'user1'), { officeId: 'harcourts-property-hub' }));
  });

  it('denies the owner granting themselves isOfficeAdmin directly', async () => {
    const db = getAuthedDb('user1');
    await setDoc(doc(db, 'users', 'user1'), { firstName: 'Alice' });
    await assertFails(updateDoc(doc(db, 'users', 'user1'), { isOfficeAdmin: true }));
  });

  it('denies changing officeId even alongside an otherwise-valid field', async () => {
    const db = getAuthedDb('user1');
    await setDoc(doc(db, 'users', 'user1'), { firstName: 'Alice' });
    await assertFails(updateDoc(doc(db, 'users', 'user1'), { firstName: 'Bob', officeId: 'some-office' }));
  });

  it('still allows updating unrelated fields when officeId is untouched', async () => {
    const db = getAuthedDb('user1');
    await setDoc(doc(db, 'users', 'user1'), { firstName: 'Alice', officeId: 'existing-office' });
    await assertSucceeds(updateDoc(doc(db, 'users', 'user1'), { firstName: 'Bob' }));
  });

  // --- privilege escalation (P0 fix) ---
  // The vulnerability: the update rule used to denylist only
  // agencyBrandId, leaving every other field — including superAdmin —
  // freely self-writable. These prove it's actually closed, not just
  // that the comment changed.
  it('SECURITY: denies a user granting themselves superAdmin via update', async () => {
    const db = getAuthedDb('user1');
    await setDoc(doc(db, 'users', 'user1'), { firstName: 'Alice' });
    await assertFails(updateDoc(doc(db, 'users', 'user1'), { superAdmin: true }));
  });

  it('SECURITY: denies granting superAdmin even bundled with an otherwise-legitimate field — all or nothing', async () => {
    const db = getAuthedDb('user1');
    await setDoc(doc(db, 'users', 'user1'), { firstName: 'Alice' });
    await assertFails(updateDoc(doc(db, 'users', 'user1'), { firstName: 'Bob', superAdmin: true }));
  });

  it('SECURITY: denies a user granting themselves superAdmin at account creation', async () => {
    const db = getAuthedDb('user1');
    await assertFails(setDoc(doc(db, 'users', 'user1'), { firstName: 'Alice', superAdmin: true }));
  });

  it('SECURITY: account creation without superAdmin still succeeds (the fix does not break signup)', async () => {
    const db = getAuthedDb('user1');
    await assertSucceeds(setDoc(doc(db, 'users', 'user1'), {
      firstName: 'Alice', lastName: 'Lee', email: 'alice@example.com', agent: false,
      pro: false, isBuyer: true, roles: ['buyer'], active: true,
    }));
  });

  it('SECURITY: a legitimately pro:true agent signup still succeeds — pro is only blocked from later self-update, not from create', async () => {
    const db = getAuthedDb('user1');
    await assertSucceeds(setDoc(doc(db, 'users', 'user1'), {
      firstName: 'Alice', pro: true, agent: true, roles: ['agent'],
    }));
  });

  // --- create-time self-escalation (officeId and friends) ---
  // The `create` rule used to allowlist NOTHING except blocking
  // superAdmin — every other privileged field (agencyBrandId,
  // brandColors, and now officeId/isOfficeAdmin/accountStatus/
  // invitedAt/activatedAt/invitedBy) was technically settable by a
  // self-signup client write at account CREATION, even though the
  // `update` rule already correctly denied all of them afterwards.
  // These prove the same self-escalation window is closed at create
  // time too — found and fixed while adding officeId.
  it.each([
    ['agencyBrandId', 'some-brand'],
    ['brandColors', { primary: '#ff0000' }],
    ['officeId', 'some-office'],
    ['isOfficeAdmin', true],
    ['accountStatus', 'active'],
    ['invitedAt', 'fake-timestamp'],
    ['activatedAt', 'fake-timestamp'],
    ['invitedBy', 'self'],
  ])('SECURITY: denies self-assigning %s at account creation', async (field, value) => {
    const db = getAuthedDb('user1');
    await assertFails(setDoc(doc(db, 'users', 'user1'), { firstName: 'Alice', [field]: value }));
  });

  it('SECURITY: denies self-assigning officeId at creation even bundled with otherwise-legitimate fields', async () => {
    const db = getAuthedDb('user1');
    await assertFails(setDoc(doc(db, 'users', 'user1'), {
      firstName: 'Alice', agent: true, pro: true, roles: ['agent'], officeId: 'harcourts-property-hub',
    }));
  });

  it('account creation with none of the server-only fields still succeeds — the fix does not break any real signup flow', async () => {
    const db = getAuthedDb('user1');
    await assertSucceeds(setDoc(doc(db, 'users', 'user1'), {
      firstName: 'Alice', lastName: 'Lee', email: 'alice@example.com',
      phone: '+61412345678', companyName: 'Harcourts Property Hub',
      pro: true, agent: true, active: true, roles: ['agent'],
    }));
  });

  it('SECURITY: denies self-granting pro via update (no legitimate self-service flow ever does this)', async () => {
    const db = getAuthedDb('user1');
    await setDoc(doc(db, 'users', 'user1'), { firstName: 'Alice', pro: false });
    await assertFails(updateDoc(doc(db, 'users', 'user1'), { pro: true }));
  });

  it('SECURITY: denies self-granting isAgent/isBuyer flags via update', async () => {
    const db = getAuthedDb('user1');
    await setDoc(doc(db, 'users', 'user1'), { firstName: 'Alice' });
    await assertFails(updateDoc(doc(db, 'users', 'user1'), { isAgent: true }));
    await assertFails(updateDoc(doc(db, 'users', 'user1'), { isBuyer: true }));
  });

  it('SECURITY: a non-admin genuinely cannot read/write anything gated by isSuperAdmin() after self-granting fails', async () => {
    const db = getAuthedDb('user1');
    await setDoc(doc(db, 'users', 'user1'), { firstName: 'Alice' });
    await assertFails(updateDoc(doc(db, 'users', 'user1'), { superAdmin: true }));
    // Confirms the escalation attempt left no trace: adminNotes (superAdmin-only) is still denied.
    await assertFails(setDoc(doc(db, 'users', 'user1', 'adminNotes', 'note1'), { text: 'hacked' }));
  });

  // --- delete ---
  it('denies delete even for own user doc', async () => {
    const db = getAuthedDb('user1');
    await setDoc(doc(db, 'users', 'user1'), { firstName: 'Alice' });
    await assertFails(deleteDoc(doc(db, 'users', 'user1')));
  });

  it('denies unauthenticated delete', async () => {
    const ownerDb = getAuthedDb('user1');
    await setDoc(doc(ownerDb, 'users', 'user1'), { firstName: 'Alice' });
    const db = getUnauthDb();
    await assertFails(deleteDoc(doc(db, 'users', 'user1')));
  });
});

describe('users/{userId}/adminNotes subcollection', () => {
  // --- read ---
  it('allows superAdmin to read admin notes', async () => {
    const db = await getSuperAdminDb();
    await setDoc(doc(db, 'users', 'user1', 'adminNotes', 'note1'), { text: 'note' });
    await assertSucceeds(getDoc(doc(db, 'users', 'user1', 'adminNotes', 'note1')));
  });

  it('denies non-superAdmin read of admin notes', async () => {
    const adminDb = await getSuperAdminDb();
    await setDoc(doc(adminDb, 'users', 'user1', 'adminNotes', 'note1'), { text: 'note' });
    const db = getAuthedDb('user1');
    await assertFails(getDoc(doc(db, 'users', 'user1', 'adminNotes', 'note1')));
  });

  it('denies unauthenticated read of admin notes', async () => {
    const adminDb = await getSuperAdminDb();
    await setDoc(doc(adminDb, 'users', 'user1', 'adminNotes', 'note1'), { text: 'note' });
    const db = getUnauthDb();
    await assertFails(getDoc(doc(db, 'users', 'user1', 'adminNotes', 'note1')));
  });

  // --- create ---
  it('allows superAdmin to create admin notes', async () => {
    const db = await getSuperAdminDb();
    await assertSucceeds(setDoc(doc(db, 'users', 'user1', 'adminNotes', 'note1'), { text: 'note' }));
  });

  it('denies non-superAdmin create of admin notes', async () => {
    const db = getAuthedDb('user1');
    await assertFails(setDoc(doc(db, 'users', 'user1', 'adminNotes', 'note1'), { text: 'note' }));
  });

  it('denies unauthenticated create of admin notes', async () => {
    const db = getUnauthDb();
    await assertFails(setDoc(doc(db, 'users', 'user1', 'adminNotes', 'note1'), { text: 'note' }));
  });

  // --- update ---
  it('allows superAdmin to update admin notes', async () => {
    const db = await getSuperAdminDb();
    await setDoc(doc(db, 'users', 'user1', 'adminNotes', 'note1'), { text: 'note' });
    await assertSucceeds(updateDoc(doc(db, 'users', 'user1', 'adminNotes', 'note1'), { text: 'updated' }));
  });

  it('denies non-superAdmin update of admin notes', async () => {
    const adminDb = await getSuperAdminDb();
    await setDoc(doc(adminDb, 'users', 'user1', 'adminNotes', 'note1'), { text: 'note' });
    const db = getAuthedDb('user1');
    await assertFails(updateDoc(doc(db, 'users', 'user1', 'adminNotes', 'note1'), { text: 'hacked' }));
  });

  // --- delete ---
  it('allows superAdmin to delete admin notes', async () => {
    const db = await getSuperAdminDb();
    await setDoc(doc(db, 'users', 'user1', 'adminNotes', 'note1'), { text: 'note' });
    await assertSucceeds(deleteDoc(doc(db, 'users', 'user1', 'adminNotes', 'note1')));
  });

  it('denies non-superAdmin delete of admin notes', async () => {
    const adminDb = await getSuperAdminDb();
    await setDoc(doc(adminDb, 'users', 'user1', 'adminNotes', 'note1'), { text: 'note' });
    const db = getAuthedDb('user1');
    await assertFails(deleteDoc(doc(db, 'users', 'user1', 'adminNotes', 'note1')));
  });
});

describe('users/{userId}/purchases subcollection', () => {
  it('allows owner to read own purchases', async () => {
    await seedDoc('users/user1/purchases/p1', { item: 'plan' });
    const db = getAuthedDb('user1');
    await assertSucceeds(getDoc(doc(db, 'users', 'user1', 'purchases', 'p1')));
  });

  it('denies other user from reading purchases', async () => {
    await seedDoc('users/user1/purchases/p1', { item: 'plan' });
    const db = getAuthedDb('user2');
    await assertFails(getDoc(doc(db, 'users', 'user1', 'purchases', 'p1')));
  });

  it('denies unauthenticated read of purchases', async () => {
    await seedDoc('users/user1/purchases/p1', { item: 'plan' });
    const db = getUnauthDb();
    await assertFails(getDoc(doc(db, 'users', 'user1', 'purchases', 'p1')));
  });

  it('denies write to purchases (even owner)', async () => {
    const db = getAuthedDb('user1');
    await assertFails(setDoc(doc(db, 'users', 'user1', 'purchases', 'p1'), { item: 'plan' }));
  });

  it('denies unauthenticated write to purchases', async () => {
    const db = getUnauthDb();
    await assertFails(setDoc(doc(db, 'users', 'user1', 'purchases', 'p1'), { item: 'plan' }));
  });
});
