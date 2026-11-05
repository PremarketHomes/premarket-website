import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { getPublicAgentProfiles, PUBLIC_PROFILE_FIELDS } from '../../src/app/api/services/publicProfileService';
import { overlayProfessionalProfile, pickUnambiguousProfile } from '../../src/app/utils/professionalProfile';

function fakeDb({ users = {}, officeAgents = [], contacts = {} }) {
  const q = (filters) => ({
    where: (f, _op, v) => q([...filters, [f, v]]),
    limit: () => q(filters),
    get: async () => ({ empty: true, docs: officeAgents.filter((p) => filters.every(([f, v]) => p[f] === v)).map((p) => ({ data: () => p })) }),
  });
  return {
    collection: (n) => {
      if (n === 'users') return { doc: (id) => ({ get: async () => (users[id] ? { exists: true, data: () => users[id] } : { exists: false }) }) };
      if (n === 'officeAgents') return q([]);
      if (n === 'properties') return q([]);
      throw new Error(`unexpected ${n}`);
    },
  };
}
const user = { firstName: 'Ivy', lastName: 'Invited', agent: true, officeId: 'hph', avatar: 'https://old/photo.jpg', phone: '0400 111 111', email: 'login@hph.com' };

describe('public profile resolves the office-managed professional profile', () => {
  it('Hannah edits once: name, phone and photo appear wherever the public profile is used', async () => {
    const db = fakeDb({ users: { u1: user }, officeAgents: [{ officeId: 'hph', linkedUid: 'u1', fullName: 'Ivy Rose Invited-Smith', phone: '0499 999 999', photoUrl: 'https://premarketvideos.b-cdn.net/new.png' }] });
    const { u1 } = await getPublicAgentProfiles(db, ['u1']);
    expect(u1).toMatchObject({ firstName: 'Ivy', lastName: 'Rose Invited-Smith', phone: '0499 999 999', avatar: 'https://premarketvideos.b-cdn.net/new.png' });
  });
  it('fields the office never set keep showing the existing users data (existing photos preserved)', async () => {
    const db = fakeDb({ users: { u1: user }, officeAgents: [{ officeId: 'hph', linkedUid: 'u1', phone: '0488 888 888' }] });
    const { u1 } = await getPublicAgentProfiles(db, ['u1']);
    expect(u1).toMatchObject({ firstName: 'Ivy', avatar: 'https://old/photo.jpg', phone: '0488 888 888' });
  });
  it('ambiguous identities are never guessed: two profiles for one uid → users data only', async () => {
    const db = fakeDb({ users: { u1: user }, officeAgents: [
      { officeId: 'hph', linkedUid: 'u1', fullName: 'Someone Else' }, { officeId: 'hph', linkedUid: 'u1', fullName: 'Another Person' } ] });
    expect((await getPublicAgentProfiles(db, ['u1'])).u1).toMatchObject({ firstName: 'Ivy', lastName: 'Invited' });
  });
  it('a profile from a different office (e.g. agent moved offices) is ignored', async () => {
    const db = fakeDb({ users: { u1: user }, officeAgents: [{ officeId: 'other', linkedUid: 'u1', fullName: 'Wrong Office' }] });
    expect((await getPublicAgentProfiles(db, ['u1'])).u1.firstName).toBe('Ivy');
  });
  it('invited agent\'s withheld phone is never public: only an explicitly set profile phone is', async () => {
    const invited = { ...user, phone: undefined, accountStatus: 'invited' };
    const db = fakeDb({ users: { u1: invited }, contacts: { u1: { phone: '0400 SECRET' } }, officeAgents: [{ officeId: 'hph', linkedUid: 'u1', fullName: 'Ivy I' }] });
    const { u1 } = await getPublicAgentProfiles(db, ['u1']);
    expect(u1.phone).toBeUndefined();
    expect(JSON.stringify(u1)).not.toContain('SECRET');
  });
  it('professional contact email and login email are never in the public profile', async () => {
    const db = fakeDb({ users: { u1: user }, officeAgents: [{ officeId: 'hph', linkedUid: 'u1', contactEmail: 'pro@hph.com', fullName: 'Ivy I' }] });
    const { u1 } = await getPublicAgentProfiles(db, ['u1']);
    expect(JSON.stringify(u1)).not.toMatch(/pro@hph|login@hph/);
    expect(PUBLIC_PROFILE_FIELDS).not.toContain('email');
  });
  it('a failing profile lookup falls back to users data instead of failing the page', async () => {
    const db = fakeDb({ users: { u1: user } });
    const orig = db.collection;
    db.collection = (n) => { if (n === 'officeAgents') throw new Error('boom'); return orig(n); };
    expect((await getPublicAgentProfiles(db, ['u1'])).u1.firstName).toBe('Ivy');
  });
  it('agents without an office are unchanged', async () => {
    const db = fakeDb({ users: { u1: { ...user, officeId: undefined } } });
    expect((await getPublicAgentProfiles(db, ['u1'])).u1).toMatchObject({ firstName: 'Ivy', avatar: 'https://old/photo.jpg' });
  });
  it('overlay helpers are pure and ignore blank values', () => {
    expect(overlayProfessionalProfile({ firstName: 'A' }, { fullName: '  ', phone: '', photoUrl: '' })).toEqual({ firstName: 'A' });
    expect(pickUnambiguousProfile([{ officeId: 'o', linkedUid: 'u' }], { uid: 'u', officeId: 'o' })).not.toBeNull();
    expect(pickUnambiguousProfile([], { uid: 'u', officeId: 'o' })).toBeNull();
  });
});

describe('compatibility boundaries (source guards)', () => {
  const read = (p) => readFileSync(p, 'utf8');
  it('listing-agent profiles (`agents`) are never read or written by the office profile code', () => {
    for (const f of ['src/app/api/services/officeAgentService.js', 'src/app/utils/professionalProfile.js']) {
      expect(read(f)).not.toMatch(/collection\(['"]agents['"]\)/);
    }
  });
  it('campaign page still lets a chosen listing agent override the account holder (existing behaviour kept)', () => {
    const page = read('src/app/components/PropertyPageClient.js');
    expect(page).toContain('if (property.agentId)');
    expect(page).toContain('property.agentName');
  });
  it('billing, invoicing, auth and notification code do not read office profiles or the professional email', () => {
    for (const f of ['billingService', 'invoicePreviewService', 'invoiceRunService', 'resendService', 'notificationService', 'xeroService']) {
      expect(read(`src/app/api/services/${f}.js`)).not.toMatch(/officeAgents|contactEmail/);
    }
    expect(read('src/app/api/middleware/auth.js')).not.toMatch(/officeAgents|contactEmail/);
  });
  it('profile service never calls Firebase Auth or touches accountStatus', () => {
    const src = read('src/app/api/services/officeAgentService.js');
    expect(src).not.toMatch(/firebase-admin\/auth|getAuth|accountStatus:\s|createUser|updateUser/);
  });
});
