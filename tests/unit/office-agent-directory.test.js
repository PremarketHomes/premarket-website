import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── tiny in-memory Firestore (collections, sub-collections, == queries, transactions) ──
const store = new Map(); // "col/id" or "col/id/sub/id" -> data
let autoId = 0;
const sentinel = 'TS';

function docRef(path) {
  const id = path.split('/').pop();
  return {
    id, path,
    get: async () => (store.has(path) ? { exists: true, id, ref: docRef(path), data: () => store.get(path) } : { exists: false, id }),
    set: async (d) => { store.set(path, { ...d }); },
    update: async (p) => { store.set(path, { ...store.get(path), ...p }); },
    collection: (sub) => colRef(`${path}/${sub}`),
  };
}
function colRef(prefix, filters = []) {
  return {
    doc: (id) => docRef(`${prefix}/${id || `auto${++autoId}`}`),
    where: (f, op, v) => colRef(prefix, [...filters, [f, v]]),
    get: async () => {
      const docs = [...store.entries()]
        .filter(([p]) => p.startsWith(`${prefix}/`) && p.split('/').length === prefix.split('/').length + 1)
        .filter(([, d]) => filters.every(([f, v]) => d[f] === v))
        .map(([p, d]) => ({ id: p.split('/').pop(), ref: docRef(p), data: () => d }));
      return { docs };
    },
  };
}
const authSpies = { verifyIdToken: vi.fn(), updateUser: vi.fn(), createUser: vi.fn(), generatePasswordResetLink: vi.fn() };

vi.mock('../../src/app/firebase/adminApp', () => ({
  adminDb: {
    collection: (n) => colRef(n),
    runTransaction: async (fn) => {
      const writes = [];
      const tx = {
        get: (x) => x.get(),
        set: (ref, d) => writes.push(() => ref.set(d)),
        update: (ref, p) => writes.push(() => ref.update(p)),
      };
      const out = await fn(tx);
      for (const w of writes) await w();
      return out;
    },
  },
}));
vi.mock('firebase-admin/firestore', () => ({ FieldValue: { serverTimestamp: () => sentinel } }));
vi.mock('firebase-admin/auth', () => ({ getAuth: () => authSpies }));
vi.mock('../../src/app/api/services/billingService', () => ({ settleChargesForAgent: vi.fn(), recordOfficeDeparture: vi.fn() }));
let stagedByOffice = {};
vi.mock('../../src/app/api/services/officeImportService', () => ({ listStagedAgents: async (o) => stagedByOffice[o] || [] }));

import { overlayProfessionalProfile } from '../../src/app/utils/professionalProfile';
import { mergeDirectory, validateProfilePatch, sniffImageType, profileCompleteness } from '../../src/app/api/services/officeAgentService';
import { GET as getDirectory } from '../../src/app/api/offices/[officeId]/agent-directory/route';
import { PATCH as patchProfile } from '../../src/app/api/offices/[officeId]/agent-profile/route';
import { POST as postPhoto } from '../../src/app/api/offices/[officeId]/agent-profile/photo/route';

const CDN = 'https://premarketvideos.b-cdn.net/';
const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(32)]);

function seed() {
  store.clear(); stagedByOffice = {};
  store.set('offices/hph', { agencyBrandId: null });
  store.set('officeAdminInfo/hph', { name: 'HPH', officeAdminUids: ['hannah'], status: 'active' });
  store.set('offices/other', { agencyBrandId: null });
  store.set('officeAdminInfo/other', { name: 'Other', officeAdminUids: ['otheradmin'], status: 'active' });
  store.set('users/hannah', { firstName: 'Hannah', lastName: 'Admin', email: 'accounts@premarket.homes', officeId: 'hph', isOfficeAdmin: true, accountStatus: 'active' });
  store.set('users/active1', { firstName: 'Ann', lastName: 'Active', email: 'ann@hph.com', officeId: 'hph', accountStatus: 'active', avatar: `${CDN}ann-old.jpg`, phone: '0400 000 001', teamId: 't1' });
  store.set('users/invited1', { firstName: 'Ivy', lastName: 'Invited', email: 'ivy@hph.com', officeId: 'hph', accountStatus: 'invited' });
  store.set('users/teamadmin', { firstName: 'Tim', lastName: 'Team', email: 'tim@hph.com', officeId: 'hph', accountStatus: 'active' });
  store.set('users/otheragent', { firstName: 'Olly', lastName: 'Other', email: 'olly@other.com', officeId: 'other', accountStatus: 'active' });
  store.set('officeAgentContacts/invited1', { phone: '0400 000 002' });
  store.set('teams/t1', { officeId: 'hph', name: 'Gold Coast Team', createdBy: 'active1' });
  stagedByOffice.hph = [{ uid: null, name: 'Sam Staged', email: 'sam@hph.com', status: 'staged' }];
}

const req = (body, uid, method = 'PATCH') => {
  authSpies.verifyIdToken.mockResolvedValue({ uid, email: `${uid}@x.com` });
  return new Request('http://localhost/t', { method, headers: { authorization: 'Bearer t', 'content-type': 'application/json' }, body: JSON.stringify(body) });
};
const params = (officeId) => ({ params: Promise.resolve({ officeId }) });
const dir = async (officeId = 'hph', uid = 'hannah') => (await (await getDirectory(req(undefined, uid, 'GET'), params(officeId))).json());

beforeEach(() => { seed(); Object.values(authSpies).forEach((s) => s.mockReset()); vi.unstubAllGlobals(); });

describe('directory merge (pure)', () => {
  it('combines users, invitations, staged rows and teams without duplicating a person', () => {
    const rows = mergeDirectory({
      users: [{ uid: 'u1', firstName: 'A', lastName: 'B', email: 'a@x.com', accountStatus: 'invited', teamId: 't1' }],
      invites: [{ targetUid: 'u1', targetEmail: 'A@x.com', targetName: 'A B' }, { targetUid: 'u2', targetEmail: 'c@x.com', targetName: 'C' }],
      staged: [{ email: 'a@x.com', name: 'A B', status: 'staged' }, { email: 'd@x.com', name: 'D', status: 'staged' }],
      teams: [{ id: 't1', name: 'Team One' }],
    });
    expect(rows.map((r) => r.email).sort()).toEqual(['a@x.com', 'c@x.com', 'd@x.com']);
    expect(rows.find((r) => r.email === 'a@x.com').team).toEqual({ id: 't1', name: 'Team One' });
    expect(rows.find((r) => r.email === 'd@x.com').loginStatus).toBe('not-activated');
  });
  it('profile completeness requires photo, name, email and phone', () => {
    expect(profileCompleteness({ name: 'A', email: 'a@x.com', phone: '1', photoUrl: 'p' }).status).toBe('ready');
    expect(profileCompleteness({ name: 'A', email: 'a@x.com', phone: null, photoUrl: null })).toEqual({ status: 'needs-details', missing: ['photo', 'phone'] });
  });
  it('does not merge two people on name alone', () => {
    const rows = mergeDirectory({ users: [
      { uid: 'u1', firstName: 'Jo', lastName: 'Smith', email: 'jo1@x.com' },
      { uid: 'u2', firstName: 'Jo', lastName: 'Smith', email: 'jo2@x.com' },
    ] });
    expect(rows).toHaveLength(2);
  });
});

describe('office agent directory API', () => {
  it('Office Admin sees every agent: active, invited (no login yet) and staged — and no fabricated rows', async () => {
    const { agents, stats } = await dir();
    expect(agents.map((a) => a.email).sort()).toEqual(['accounts@premarket.homes', 'ann@hph.com', 'ivy@hph.com', 'sam@hph.com', 'tim@hph.com']);
    const ivy = agents.find((a) => a.email === 'ivy@hph.com');
    expect(ivy).toMatchObject({ loginStatus: 'invited', phone: '0400 000 002', profileStatus: 'needs-details', canResend: true });
    expect(agents.find((a) => a.email === 'sam@hph.com')).toMatchObject({ loginStatus: 'not-activated', uid: null });
    const ann = agents.find((a) => a.email === 'ann@hph.com');
    expect(ann).toMatchObject({ loginStatus: 'active', photoUrl: `${CDN}ann-old.jpg`, profileStatus: 'ready', team: { name: 'Gold Coast Team' } });
    expect(stats.total).toBe(5);
    expect(stats.missingPhoto).toBe(4);
  });
  it('is read-only: GET writes nothing and never touches Auth', async () => {
    const before = JSON.stringify([...store.entries()]);
    await dir();
    expect(JSON.stringify([...store.entries()])).toBe(before);
    expect(authSpies.createUser).not.toHaveBeenCalled();
    expect(authSpies.updateUser).not.toHaveBeenCalled();
  });
  it('blocks other-office admins, agents and unauthenticated callers (cross-office isolation)', async () => {
    expect((await getDirectory(req(undefined, 'otheradmin', 'GET'), params('hph'))).status).toBe(403);
    expect((await getDirectory(req(undefined, 'active1', 'GET'), params('hph'))).status).toBe(403);
    expect((await getDirectory(req(undefined, 'teamadmin', 'GET'), params('hph'))).status).toBe(403);
    const noAuth = await getDirectory(new Request('http://localhost/t'), params('hph'));
    expect(noAuth.status).toBe(401);
  });
  it("never lists another office's agents", async () => {
    const { agents } = await dir();
    expect(agents.some((a) => a.email === 'olly@other.com')).toBe(false);
  });
});

describe('profile editing', () => {
  it('Office Admin can edit an agent who has never logged in; Auth and accountStatus are untouched', async () => {
    const ivy = (await dir()).agents.find((a) => a.email === 'ivy@hph.com');
    const res = await patchProfile(req({ key: ivy.key, fullName: 'Ivy Invited-Smith', phone: '0411 111 111', contactEmail: 'IVY.PRO@hph.com' }, 'hannah'), params('hph'));
    expect(res.status).toBe(200);
    const after = (await dir()).agents.find((a) => a.uid === 'invited1');
    expect(after).toMatchObject({ name: 'Ivy Invited-Smith', phone: '0411 111 111', email: 'ivy.pro@hph.com', loginStatus: 'invited' });
    expect(store.get('users/invited1').accountStatus).toBe('invited');
    expect(store.get('users/invited1').email).toBe('ivy@hph.com'); // login email unchanged
    expect(authSpies.updateUser).not.toHaveBeenCalled();
    expect(authSpies.createUser).not.toHaveBeenCalled();
  });
  it('staged (no account) agent can be completed without creating a user', async () => {
    const sam = (await dir()).agents.find((a) => a.email === 'sam@hph.com');
    expect((await patchProfile(req({ key: sam.key, phone: '0422 222 222' }, 'hannah'), params('hph'))).status).toBe(200);
    expect((await dir()).agents.find((a) => a.email === 'sam@hph.com')).toMatchObject({ phone: '0422 222 222', loginStatus: 'not-activated' });
    expect([...store.keys()].some((k) => k.startsWith('users/') && store.get(k).email === 'sam@hph.com')).toBe(false);
  });
  it('repeated edits update ONE profile (duplicate prevention) and are audited', async () => {
    for (const phone of ['0400 100 100', '0400 200 200', '0400 300 300']) {
      const a = (await dir()).agents.find((x) => x.uid === 'invited1');
      await patchProfile(req({ key: a.key, phone }, 'hannah'), params('hph'));
    }
    const profiles = [...store.keys()].filter((k) => /^officeAgents\/[^/]+$/.test(k));
    expect(profiles).toHaveLength(1);
    expect(store.get(profiles[0]).linkedUid).toBe('invited1');
    expect([...store.keys()].filter((k) => k.includes('/audit/'))).toHaveLength(3);
    expect((await dir()).agents.filter((a) => a.email === 'ivy@hph.com' || a.uid === 'invited1')).toHaveLength(1);
  });
  it('preserves existing data on a partial edit (seeded from existing record)', async () => {
    const ann = (await dir()).agents.find((a) => a.uid === 'active1');
    await patchProfile(req({ key: ann.key, phone: '0499 999 999' }, 'hannah'), params('hph'));
    const after = (await dir()).agents.find((a) => a.uid === 'active1');
    expect(after).toMatchObject({ name: 'Ann Active', photoUrl: `${CDN}ann-old.jpg`, phone: '0499 999 999', loginStatus: 'active' });
  });
  it('Remove photo: back to missing-photo, other details/campaigns/other agents untouched, nothing deleted', async () => {
    store.set('properties/p-ann', { userId: 'active1', agentAvatar: null, title: 'T' });
    const ann = (await dir()).agents.find((a) => a.uid === 'active1');
    await patchProfile(req({ key: ann.key, photoUrl: `${CDN}office-agents/hph/new.png`, phone: '0499 999 999' }, 'hannah'), params('hph'));
    const before = (await dir()).agents.find((a) => a.uid === 'active1');
    expect(before.photoUrl).toBe(`${CDN}office-agents/hph/new.png`);
    const otherBefore = JSON.stringify(store.get('users/invited1'));

    const res = await patchProfile(req({ key: before.key, removePhoto: true }, 'hannah'), params('hph'));
    expect(res.status).toBe(200);
    const after = (await dir()).agents.find((a) => a.uid === 'active1');
    expect(after).toMatchObject({ photoUrl: null, name: 'Ann Active', phone: '0499 999 999', loginStatus: 'active' });
    expect(after.missing).toContain('photo');
    expect(store.get('users/active1').avatar).toMatch(/Profile_avatar_placeholder/);
    expect(store.get('users/active1').officeId).toBe('hph');
    expect(store.get('properties/p-ann')).toEqual({ userId: 'active1', agentAvatar: null, title: 'T' });
    expect(JSON.stringify(store.get('users/invited1'))).toBe(otherBefore);
    // public profile: a cleared office photo no longer overrides, so visitors see the (placeholder) login avatar
    const prof = [...store.entries()].find(([k]) => /^officeAgents\/[^/]+$/.test(k))[1];
    expect(overlayProfessionalProfile({ avatar: store.get('users/active1').avatar }, prof).avatar).toMatch(/Profile_avatar_placeholder/);
  });
  it('Remove photo is office-admin only and cannot be combined with a new photo', async () => {
    const ann = (await dir()).agents.find((a) => a.uid === 'active1');
    for (const uid of ['teamadmin', 'active1', 'otheradmin']) {
      expect((await patchProfile(req({ key: ann.key, removePhoto: true }, uid), params('hph'))).status).toBe(403);
    }
    expect(store.get('users/active1').avatar).toBe(`${CDN}ann-old.jpg`);
    expect(() => validateProfilePatch({ removePhoto: true, photoUrl: `${CDN}x.png` })).toThrow();
  });
  it('Team Admins / agents / other-office admins cannot edit', async () => {
    const ivy = (await dir()).agents.find((a) => a.uid === 'invited1');
    for (const uid of ['teamadmin', 'active1', 'otheradmin']) {
      expect((await patchProfile(req({ key: ivy.key, phone: '0400 000 999' }, uid), params('hph'))).status).toBe(403);
    }
    expect([...store.keys()].some((k) => k.startsWith('officeAgents/'))).toBe(false);
  });
  it("an office admin cannot address another office's agent by key", async () => {
    const res = await patchProfile(req({ key: 'u:otheragent', phone: '0400 000 999' }, 'hannah'), params('hph'));
    expect(res.status).toBe(404);
    expect(store.get('users/otheragent').phone).toBeUndefined();
  });
  it('validates input', () => {
    expect(() => validateProfilePatch({ fullName: '  ' })).toThrow();
    expect(() => validateProfilePatch({ contactEmail: 'nope' })).toThrow();
    expect(() => validateProfilePatch({ phone: '<script>' })).toThrow();
    expect(() => validateProfilePatch({ photoUrl: 'https://evil.example/x.png' })).toThrow();
    expect(() => validateProfilePatch({})).toThrow();
    expect(validateProfilePatch({ photoUrl: `${CDN}office-agents/hph/a.png` })).toEqual({ photoUrl: `${CDN}office-agents/hph/a.png` });
  });
});

describe('profile consistency in the directory', () => {
  it('first edit stores only what was set; nothing is copied from users (agent\'s own later changes still show)', async () => {
    const ann = (await dir()).agents.find((a) => a.uid === 'active1');
    await patchProfile(req({ key: ann.key, phone: '0499 000 111' }, 'hannah'), params('hph'));
    const profile = [...store.entries()].find(([k]) => /^officeAgents\/[^/]+$/.test(k))[1];
    expect(profile).not.toHaveProperty('photoUrl');
    expect(profile).not.toHaveProperty('fullName');
    store.set('users/active1', { ...store.get('users/active1'), avatar: `${CDN}ann-new-own.jpg` });
    expect((await dir()).agents.find((a) => a.uid === 'active1').photoUrl).toBe(`${CDN}ann-new-own.jpg`);
  });
  it('editing the professional email never changes the profile identity key, login email, or Auth', async () => {
    const ivy = (await dir()).agents.find((a) => a.uid === 'invited1');
    await patchProfile(req({ key: ivy.key, contactEmail: 'new.pro@hph.com' }, 'hannah'), params('hph'));
    const profile = [...store.entries()].find(([k]) => /^officeAgents\/[^/]+$/.test(k))[1];
    expect(profile.emailKey).toBe('ivy@hph.com');
    const row = (await dir()).agents.find((a) => a.uid === 'invited1');
    expect(row).toMatchObject({ email: 'new.pro@hph.com', loginEmail: 'ivy@hph.com' });
    expect(store.get('users/invited1').email).toBe('ivy@hph.com');
    expect(authSpies.updateUser).not.toHaveBeenCalled();
  });
  it('a held invitation phone is shown to the admin but never copied into the profile unless explicitly typed', async () => {
    const ivy = (await dir()).agents.find((a) => a.uid === 'invited1');
    expect(ivy).toMatchObject({ phone: '0400 000 002', phoneHeld: true });
    await patchProfile(req({ key: ivy.key, fullName: 'Ivy I' }, 'hannah'), params('hph'));
    const profile = [...store.entries()].find(([k]) => /^officeAgents\/[^/]+$/.test(k))[1];
    expect(profile.phone).toBeUndefined();
    expect(store.get('users/invited1').phone).toBeUndefined();
    expect((await dir()).agents.find((a) => a.uid === 'invited1').phoneHeld).toBe(true);
    const fresh = (await dir()).agents.find((a) => a.uid === 'invited1');
    expect((await patchProfile(req({ key: fresh.key, phone: '0400 000 002' }, 'hannah'), params('hph'))).status).toBe(200);
    expect((await dir()).agents.find((a) => a.uid === 'invited1').phoneHeld).toBe(false);
  });
  it('two profiles for one agent are flagged, not guessed; editing is refused (409)', async () => {
    store.set('officeAgents/dupA', { officeId: 'hph', linkedUid: 'invited1', emailKey: 'ivy@hph.com', fullName: 'A' });
    store.set('officeAgents/dupB', { officeId: 'hph', linkedUid: 'invited1', emailKey: 'ivy@hph.com', fullName: 'B' });
    const ivy = (await dir()).agents.find((a) => a.uid === 'invited1');
    expect(ivy.profileConflict).toBe(true);
    expect(ivy.name).toBe('Ivy Invited'); // users data, neither duplicate applied
    expect((await patchProfile(req({ key: ivy.key, phone: '0400 123 123' }, 'hannah'), params('hph'))).status).toBe(409);
  });
  it('the listing-agent `agents` records are never modified by a profile/photo edit', async () => {
    store.set('agents/la1', { userId: 'active1', name: 'Different Person', avatar: 'https://la/own.jpg' });
    const ann = (await dir()).agents.find((a) => a.uid === 'active1');
    await patchProfile(req({ key: ann.key, fullName: 'Ann Renamed', photoUrl: `${CDN}x.png` }, 'hannah'), params('hph'));
    expect(store.get('agents/la1')).toEqual({ userId: 'active1', name: 'Different Person', avatar: 'https://la/own.jpg' });
  });
});

describe('placeholder avatars are not photos (the "Missing photo" filter depends on it)', () => {
  const PH = 'https://upload.wikimedia.org/wikipedia/commons/7/7c/Profile_avatar_placeholder_large.png?20150327203541';
  it('an agent whose login record only has the shared placeholder image shows as missing a photo', async () => {
    store.set('users/invited1', { ...store.get('users/invited1'), avatar: PH });
    store.set('users/active1', { ...store.get('users/active1'), avatar: `${CDN}real.jpg` });
    const { agents, stats } = await dir();
    expect(agents.find((a) => a.uid === 'invited1')).toMatchObject({ photoUrl: null, profileStatus: 'needs-details' });
    expect(agents.find((a) => a.uid === 'invited1').missing).toContain('photo');
    expect(agents.find((a) => a.uid === 'active1').photoUrl).toBe(`${CDN}real.jpg`);
    expect(stats.missingPhoto).toBe(4);
  });
});

describe('photo upload', () => {
  const photoReq = (uid, key, bytes, name = 'p.png') => {
    authSpies.verifyIdToken.mockResolvedValue({ uid });
    const fd = new FormData();
    fd.append('key', key);
    if (bytes) fd.append('file', new File([bytes], name, { type: 'image/png' }));
    return new Request('http://localhost/t', { method: 'POST', headers: { authorization: 'Bearer t' }, body: fd });
  };
  beforeEach(() => { process.env.BUNNY_STORAGE_ACCESS_KEY = 'k'; });

  it('detects type from bytes, not client claims', () => {
    expect(sniffImageType(png).mime).toBe('image/png');
    expect(sniffImageType(Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(20)])).mime).toBe('image/jpeg');
    expect(sniffImageType(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>'))).toBeNull();
    expect(sniffImageType(Buffer.from('GIF89a......................'))).toBeNull();
  });
  it('Office Admin photo upload → save: photo shows in directory and in the existing users.avatar view; login untouched', async () => {
    const fetchMock = vi.fn(async () => ({ ok: true }));
    vi.stubGlobal('fetch', fetchMock);
    const ivy = (await dir()).agents.find((a) => a.uid === 'invited1');
    const up = await postPhoto(photoReq('hannah', ivy.key, png), params('hph'));
    expect(up.status).toBe(200);
    const { url } = await up.json();
    expect(url.startsWith(`${CDN}office-agents/hph/`)).toBe(true);
    expect(fetchMock.mock.calls[0][0]).toContain('/premarketvideos/office-agents/hph/');
    await patchProfile(req({ key: ivy.key, photoUrl: url }, 'hannah'), params('hph'));
    expect((await dir()).agents.find((a) => a.uid === 'invited1').photoUrl).toBe(url);
    expect(store.get('users/invited1').avatar).toBe(url);
    expect(store.get('users/invited1').accountStatus).toBe('invited');
    expect(authSpies.updateUser).not.toHaveBeenCalled();
  });
  it('replaces an existing photo only when explicitly uploaded; staged agents get no users write', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true })));
    const sam = (await dir()).agents.find((a) => a.email === 'sam@hph.com');
    const { url } = await (await postPhoto(photoReq('hannah', sam.key, png), params('hph'))).json();
    await patchProfile(req({ key: sam.key, photoUrl: url }, 'hannah'), params('hph'));
    expect((await dir()).agents.find((a) => a.email === 'sam@hph.com').photoUrl).toBe(url);
    expect(store.get('users/active1').avatar).toBe(`${CDN}ann-old.jpg`);
  });
  it('rejects wrong types, oversize files, other-office targets and non-admins', async () => {
    const fetchMock = vi.fn(async () => ({ ok: true }));
    vi.stubGlobal('fetch', fetchMock);
    const ivy = (await dir()).agents.find((a) => a.uid === 'invited1');
    expect((await postPhoto(photoReq('hannah', ivy.key, Buffer.from('<svg></svg>........')), params('hph'))).status).toBe(400);
    expect((await postPhoto(photoReq('hannah', ivy.key, Buffer.alloc(5 * 1024 * 1024 + 1, 1)), params('hph'))).status).toBe(400);
    expect((await postPhoto(photoReq('hannah', 'u:otheragent', png), params('hph'))).status).toBe(404);
    expect((await postPhoto(photoReq('teamadmin', ivy.key, png), params('hph'))).status).toBe(403);
    expect((await postPhoto(photoReq('otheradmin', ivy.key, png), params('hph'))).status).toBe(403);
    expect((await postPhoto(photoReq('hannah', ivy.key, null), params('hph'))).status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('existing accounts keep working', () => {
  it('accounts@premarket.homes remains the office admin and still sees itself in the directory', async () => {
    const { agents } = await dir('hph', 'hannah');
    expect(agents.find((a) => a.email === 'accounts@premarket.homes')).toMatchObject({ isOfficeAdmin: true, loginStatus: 'active' });
    expect(store.get('officeAdminInfo/hph').officeAdminUids).toEqual(['hannah']);
  });
  it('profile edits never change roles or officeAdminUids', async () => {
    const t = (await dir()).agents.find((a) => a.uid === 'teamadmin');
    await patchProfile(req({ key: t.key, phone: '0400 555 555' }, 'hannah'), params('hph'));
    expect(store.get('officeAdminInfo/hph').officeAdminUids).toEqual(['hannah']);
    expect(store.get('users/teamadmin').isOfficeAdmin).toBeUndefined();
  });
});
