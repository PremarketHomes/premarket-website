import { describe, it, expect, vi, beforeEach } from 'vitest';

const state = { users: {}, agencyBrands: {}, agencyMemberships: {} };

function makeCollection(name) {
  return {
    doc: (id) => ({
      get: vi.fn().mockImplementation(async () => (
        state[name][id] ? { exists: true, data: () => state[name][id] } : { exists: false }
      )),
      set: vi.fn().mockImplementation(async (data) => { state[name][id] = data; }),
      update: vi.fn().mockImplementation(async (patch) => {
        state[name][id] = { ...(state[name][id] || {}), ...patch };
      }),
      // Mirrors real Firestore: throws ALREADY_EXISTS (gRPC code 6)
      // rather than overwriting, if a doc at this id already exists —
      // including when two calls "race" (see the concurrent-creation
      // test below, which relies on this synchronous check happening
      // before either write lands, exactly like a real atomic create).
      create: vi.fn().mockImplementation(async (data) => {
        if (state[name][id]) {
          const err = new Error('ALREADY_EXISTS: Document already exists');
          err.code = 6;
          throw err;
        }
        state[name][id] = { ...data };
      }),
    }),
    where(field, op, value) {
      function matches(raw) {
        if (op === '==') return raw[field] === value;
        if (op === '!=') return raw[field] !== value && raw[field] !== undefined;
        return true;
      }
      const docs = Object.entries(state[name])
        .filter(([, data]) => matches(data))
        .map(([id, data]) => ({ id, data: () => data }));
      return { get: vi.fn().mockImplementation(async () => ({ docs })) };
    },
    get: vi.fn().mockImplementation(async () => ({
      docs: Object.entries(state[name]).map(([id, data]) => ({ id, data: () => data })),
    })),
  };
}

vi.mock('../../src/app/firebase/adminApp', () => ({
  adminDb: {
    collection: (name) => {
      if (!['users', 'agencyBrands', 'agencyMemberships'].includes(name)) {
        throw new Error(`Unexpected collection in test: ${name}`);
      }
      return makeCollection(name);
    },
  },
}));

vi.mock('firebase-admin/firestore', () => ({
  FieldValue: { serverTimestamp: () => 'TIMESTAMP' },
}));

function resetState() {
  state.users = {};
  state.agencyBrands = {};
  state.agencyMemberships = {};
}

describe('buildColorSet', () => {
  beforeEach(() => resetState());

  it('computes accessible text colours server-side regardless of what is submitted', async () => {
    const { buildColorSet } = await import('../../src/app/api/services/brandProfileService');
    const colors = buildColorSet({ primary: '#011d47', secondary: '#01a8ec' });
    expect(colors.primaryText).toBe('#ffffff');
    expect(colors.secondaryText).toBe('#000000');
    expect(colors.primaryTextMeetsContrast).toBe(true);
  });

  it('derives a darker gradient stop automatically so the agent only picks one primary colour', async () => {
    const { buildColorSet } = await import('../../src/app/api/services/brandProfileService');
    const colors = buildColorSet({ primary: '#011d47' });
    expect(colors.primaryDark).toBeDefined();
    expect(colors.primaryDark).not.toBe(colors.primary);
  });

  it('rejects an invalid/missing primary colour rather than saving something broken', async () => {
    const { buildColorSet } = await import('../../src/app/api/services/brandProfileService');
    expect(() => buildColorSet({ primary: 'not-a-colour' })).toThrow();
    expect(() => buildColorSet({})).toThrow();
  });

  it('omits secondary fields entirely when no secondary colour is given', async () => {
    const { buildColorSet } = await import('../../src/app/api/services/brandProfileService');
    const colors = buildColorSet({ primary: '#011d47' });
    expect(colors.secondary).toBeUndefined();
  });
});

describe('createBrand / getBrandForUser', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetState();
  });

  it('creates a brand, links only the confirming user\'s account, and verifies them as the creator', async () => {
    const { createBrand, getBrandForUser } = await import('../../src/app/api/services/brandProfileService');
    const { brandId } = await createBrand({
      uid: 'agent1',
      name: 'Harcourts Property Hub',
      logoUrl: 'https://example.com/harcourts.png',
      primary: '#011d47',
      secondary: '#01a8ec',
    });

    expect(state.users.agent1.agencyBrandId).toBe(brandId);
    expect(state.agencyBrands[brandId].name).toBe('Harcourts Property Hub');
    expect(state.agencyBrands[brandId].createdBy).toBe('agent1');
    expect(state.agencyMemberships.agent1.status).toBe('verified');

    const resolved = await getBrandForUser('agent1');
    expect(resolved.name).toBe('Harcourts Property Hub');
  });

  it('SECURITY: an ordinary agent cannot "create" a brand with an EXISTING agency\'s exact name — createdBy, logo and colours stay the real creator\'s', async () => {
    const { createBrand } = await import('../../src/app/api/services/brandProfileService');
    await createBrand({ uid: 'realCreator', name: 'Harcourts Property Hub', logoUrl: 'https://real.example.com/logo.png', primary: '#011d47' });
    const brandIdBefore = Object.keys(state.agencyBrands)[0];
    const brandBefore = { ...state.agencyBrands[brandIdBefore] };

    await expect(createBrand({
      uid: 'attacker', name: 'Harcourts Property Hub', logoUrl: 'https://attacker.example.com/evil.png', primary: '#ff0000',
    })).rejects.toThrow(/already exists/i);

    // The real brand document is completely untouched — not just
    // "mostly" unchanged.
    expect(state.agencyBrands[brandIdBefore]).toEqual(brandBefore);
    expect(state.agencyBrands[brandIdBefore].createdBy).toBe('realCreator');
    expect(state.agencyBrands[brandIdBefore].logoUrl).toBe('https://real.example.com/logo.png');
  });

  it('SECURITY: a failed (colliding) brand creation leaves the attacker with NO agencyBrandId and NO verified membership', async () => {
    const { createBrand } = await import('../../src/app/api/services/brandProfileService');
    await createBrand({ uid: 'realCreator', name: 'Harcourts Property Hub', primary: '#011d47' });

    await expect(createBrand({ uid: 'attacker', name: 'Harcourts Property Hub', primary: '#ff0000' })).rejects.toThrow();

    expect(state.users.attacker).toBeUndefined();
    expect(state.agencyMemberships.attacker).toBeUndefined();
  });

  it('SECURITY: alternate spellings/punctuation that normalise to the SAME slug are blocked exactly like an identical name', async () => {
    const { createBrand } = await import('../../src/app/api/services/brandProfileService');
    await createBrand({ uid: 'realCreator', name: 'Harcourts Property Hub', primary: '#011d47' });

    // Different raw string, same slugified id — the attack doesn't
    // require byte-identical input, just a name that resolves to the
    // same document id.
    await expect(createBrand({ uid: 'attacker', name: '  Harcourts   Property -- Hub!!', primary: '#ff0000' })).rejects.toThrow(/already exists/i);
    expect(state.agencyBrands['harcourts-property-hub'].createdBy).toBe('realCreator');
  });

  it('SECURITY: of two simultaneous creation requests for the same agency name, exactly one succeeds and the other is rejected — never two brands, never an overwrite', async () => {
    const { createBrand } = await import('../../src/app/api/services/brandProfileService');

    const results = await Promise.allSettled([
      createBrand({ uid: 'agentA', name: 'Simultaneous Agency', primary: '#011d47' }),
      createBrand({ uid: 'agentB', name: 'Simultaneous Agency', primary: '#ff0000' }),
    ]);

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0].reason.message).toMatch(/already exists/i);

    // Exactly one brand document exists, and exactly one of the two
    // accounts ended up with a verified membership.
    expect(Object.keys(state.agencyBrands)).toHaveLength(1);
    const verifiedUids = Object.values(state.agencyMemberships).filter((m) => m.status === 'verified').map((m) => m.uid);
    expect(verifiedUids).toHaveLength(1);
  });

  it('a genuinely new, non-colliding brand name still creates successfully (the fix only blocks real collisions)', async () => {
    const { createBrand } = await import('../../src/app/api/services/brandProfileService');
    const result = await createBrand({ uid: 'agent1', name: 'Totally Unique Agency Name', primary: '#011d47' });
    expect(result.brandId).toBeTruthy();
    expect(state.agencyBrands[result.brandId].createdBy).toBe('agent1');
  });

  it('getBrandForUser returns null for an account with no agencyBrandId (existing agents, unaffected)', async () => {
    state.users.agent2 = { name: 'Existing Agent' };
    const { getBrandForUser } = await import('../../src/app/api/services/brandProfileService');
    expect(await getBrandForUser('agent2')).toBeNull();
  });
});

describe('requestAgencyMembership — applies branding immediately, trust stays pending', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetState();
  });

  it('applies branding (agencyBrandId) immediately but leaves the membership pending — never verified by companyName alone', async () => {
    const { createBrand, requestAgencyMembership, isVerifiedAgencyMember } = await import('../../src/app/api/services/brandProfileService');
    const { brandId } = await createBrand({ uid: 'agent1', name: 'Harcourts Property Hub', primary: '#011d47' });
    state.users.agent2 = { companyName: 'Harcourts Property Hub' };

    const result = await requestAgencyMembership({ uid: 'agent2', brandId });

    expect(result.membershipStatus).toBe('pending');
    expect(state.users.agent2.agencyBrandId).toBe(brandId); // branding display preserved immediately
    expect(state.agencyMemberships.agent2.status).toBe('pending');
    expect(await isVerifiedAgencyMember('agent2', brandId)).toBe(false); // NOT trusted for billing yet
    expect(state.users.agent1.agencyBrandId).toBe(brandId); // untouched, still correct
  });

  it('rejects an unknown brandId', async () => {
    state.users.agent1 = { companyName: 'Anything' };
    const { requestAgencyMembership } = await import('../../src/app/api/services/brandProfileService');
    await expect(requestAgencyMembership({ uid: 'agent1', brandId: 'does-not-exist' })).rejects.toThrow();
    expect(state.users.agent1.agencyBrandId).toBeUndefined();
  });

  it('rejects a request whose companyName does not match the brand (sanity guard, not a trust grant either way)', async () => {
    const { createBrand, requestAgencyMembership } = await import('../../src/app/api/services/brandProfileService');
    const { brandId } = await createBrand({ uid: 'agent1', name: 'Harcourts Property Hub', primary: '#011d47' });
    state.users.agent2 = { companyName: 'Some Rival Agency' };

    await expect(requestAgencyMembership({ uid: 'agent2', brandId })).rejects.toThrow();
    expect(state.users.agent2.agencyBrandId).toBeUndefined();
  });

  it('rejects a request when the agent has no companyName at all', async () => {
    const { createBrand, requestAgencyMembership } = await import('../../src/app/api/services/brandProfileService');
    const { brandId } = await createBrand({ uid: 'agent1', name: 'Harcourts Property Hub', primary: '#011d47' });
    state.users.agent2 = {};

    await expect(requestAgencyMembership({ uid: 'agent2', brandId })).rejects.toThrow();
    expect(state.users.agent2.agencyBrandId).toBeUndefined();
  });

  it('the brand\'s own creator "requesting" membership in their own brand is a no-op that stays verified', async () => {
    const { createBrand, requestAgencyMembership } = await import('../../src/app/api/services/brandProfileService');
    const { brandId } = await createBrand({ uid: 'agent1', name: 'Harcourts Property Hub', primary: '#011d47' });

    const result = await requestAgencyMembership({ uid: 'agent1', brandId });
    expect(result.membershipStatus).toBe('verified');
  });
});

describe('approveAgencyMembership / rejectAgencyMembership', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetState();
  });

  it('approving a pending request makes isVerifiedAgencyMember true', async () => {
    const { createBrand, requestAgencyMembership, approveAgencyMembership, isVerifiedAgencyMember } = await import('../../src/app/api/services/brandProfileService');
    const { brandId } = await createBrand({ uid: 'agent1', name: 'Harcourts Property Hub', primary: '#011d47' });
    state.users.agent2 = { companyName: 'Harcourts Property Hub' };
    await requestAgencyMembership({ uid: 'agent2', brandId });

    await approveAgencyMembership({ uid: 'agent2', adminUid: 'admin1' });

    expect(await isVerifiedAgencyMember('agent2', brandId)).toBe(true);
    expect(state.agencyMemberships.agent2.verifiedBy).toBe('admin1');
  });

  it('a "legacy" account (agencyBrandId set with no membership record at all, predating this system) can still be approved', async () => {
    const { createBrand, approveAgencyMembership, isVerifiedAgencyMember } = await import('../../src/app/api/services/brandProfileService');
    const { brandId } = await createBrand({ uid: 'agent1', name: 'Harcourts Property Hub', primary: '#011d47' });
    // Simulates a pre-existing link with no agencyMemberships doc at all.
    state.users.agent2 = { companyName: 'Harcourts Property Hub', agencyBrandId: brandId };
    expect(state.agencyMemberships.agent2).toBeUndefined();

    await approveAgencyMembership({ uid: 'agent2', adminUid: 'admin1' });

    expect(await isVerifiedAgencyMember('agent2', brandId)).toBe(true);
  });

  it('approving with no request and no existing agencyBrandId link fails', async () => {
    const { approveAgencyMembership } = await import('../../src/app/api/services/brandProfileService');
    state.users.agent2 = { companyName: 'Nothing To Approve' };
    await expect(approveAgencyMembership({ uid: 'agent2', adminUid: 'admin1' })).rejects.toThrow();
  });

  it('rejecting a pending request clears agencyBrandId (branding) and leaves it unverified', async () => {
    const { createBrand, requestAgencyMembership, rejectAgencyMembership, isVerifiedAgencyMember } = await import('../../src/app/api/services/brandProfileService');
    const { brandId } = await createBrand({ uid: 'agent1', name: 'Harcourts Property Hub', primary: '#011d47' });
    state.users.agent2 = { companyName: 'Harcourts Property Hub' };
    await requestAgencyMembership({ uid: 'agent2', brandId });

    await rejectAgencyMembership({ uid: 'agent2', adminUid: 'admin1', reason: 'Not a real colleague' });

    expect(state.users.agent2.agencyBrandId).toBeNull();
    expect(await isVerifiedAgencyMember('agent2', brandId)).toBe(false);
    expect(state.agencyMemberships.agent2.status).toBe('rejected');
    expect(state.agencyMemberships.agent2.rejectionReason).toBe('Not a real colleague');
  });

  it('rejecting a legacy link (no membership record) also clears agencyBrandId', async () => {
    const { createBrand, rejectAgencyMembership } = await import('../../src/app/api/services/brandProfileService');
    const { brandId } = await createBrand({ uid: 'agent1', name: 'Harcourts Property Hub', primary: '#011d47' });
    state.users.agent2 = { companyName: 'Harcourts Property Hub', agencyBrandId: brandId };

    await rejectAgencyMembership({ uid: 'agent2', adminUid: 'admin1', reason: 'Unrelated account' });

    expect(state.users.agent2.agencyBrandId).toBeNull();
  });

  it('rejection never touches the brand itself or the creator\'s own membership', async () => {
    const { createBrand, requestAgencyMembership, rejectAgencyMembership } = await import('../../src/app/api/services/brandProfileService');
    const { brandId } = await createBrand({ uid: 'agent1', name: 'Harcourts Property Hub', primary: '#011d47' });
    state.users.agent2 = { companyName: 'Harcourts Property Hub' };
    await requestAgencyMembership({ uid: 'agent2', brandId });

    await rejectAgencyMembership({ uid: 'agent2', adminUid: 'admin1' });

    expect(state.agencyBrands[brandId]).toBeDefined();
    expect(state.users.agent1.agencyBrandId).toBe(brandId);
    expect(state.agencyMemberships.agent1.status).toBe('verified');
  });
});

describe('isVerifiedAgencyMember', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetState();
  });

  it('the brand creator is always verified, even with no agencyMemberships doc at all', async () => {
    const { isVerifiedAgencyMember } = await import('../../src/app/api/services/brandProfileService');
    state.agencyBrands['brand-x'] = { name: 'X Agency', createdBy: 'creatorUid' };
    delete state.agencyMemberships.creatorUid;

    expect(await isVerifiedAgencyMember('creatorUid', 'brand-x')).toBe(true);
  });

  it('an account with agencyBrandId set but NO membership record is NOT verified (the exact pre-existing-link case)', async () => {
    const { isVerifiedAgencyMember } = await import('../../src/app/api/services/brandProfileService');
    state.agencyBrands['brand-x'] = { name: 'X Agency', createdBy: 'someoneElse' };

    expect(await isVerifiedAgencyMember('unrelatedUid', 'brand-x')).toBe(false);
  });

  it('a verified membership for a DIFFERENT brand does not carry over to this one', async () => {
    const { isVerifiedAgencyMember } = await import('../../src/app/api/services/brandProfileService');
    state.agencyBrands['brand-x'] = { name: 'X Agency', createdBy: 'someoneElse' };
    state.agencyMemberships.agent2 = { uid: 'agent2', agencyBrandId: 'brand-y', status: 'verified' };

    expect(await isVerifiedAgencyMember('agent2', 'brand-x')).toBe(false);
  });

  it('a rejected membership is not verified', async () => {
    const { isVerifiedAgencyMember } = await import('../../src/app/api/services/brandProfileService');
    state.agencyBrands['brand-x'] = { name: 'X Agency', createdBy: 'someoneElse' };
    state.agencyMemberships.agent2 = { uid: 'agent2', agencyBrandId: 'brand-x', status: 'rejected' };

    expect(await isVerifiedAgencyMember('agent2', 'brand-x')).toBe(false);
  });
});

describe('listPendingAgencyMemberships', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetState();
  });

  it('lists an explicit pending request', async () => {
    const { createBrand, requestAgencyMembership, listPendingAgencyMemberships } = await import('../../src/app/api/services/brandProfileService');
    const { brandId } = await createBrand({ uid: 'agent1', name: 'Harcourts Property Hub', primary: '#011d47' });
    state.users.agent2 = { companyName: 'Harcourts Property Hub' };
    await requestAgencyMembership({ uid: 'agent2', brandId });

    const pending = await listPendingAgencyMemberships();
    expect(pending.map((p) => p.uid)).toContain('agent2');
    expect(pending.find((p) => p.uid === 'agent2').source).toBe('request');
  });

  it('surfaces a legacy agencyBrandId link (no membership record, not the creator) for admin review', async () => {
    const { createBrand, listPendingAgencyMemberships } = await import('../../src/app/api/services/brandProfileService');
    const { brandId } = await createBrand({ uid: 'agent1', name: 'Harcourts Property Hub', primary: '#011d47' });
    state.users.agent2 = { companyName: 'Harcourts Property Hub', agencyBrandId: brandId };

    const pending = await listPendingAgencyMemberships();
    const legacyEntry = pending.find((p) => p.uid === 'agent2');
    expect(legacyEntry).toBeDefined();
    expect(legacyEntry.source).toBe('legacy');
  });

  it('never lists the brand creator, verified members, or accounts with no agencyBrandId at all', async () => {
    const { createBrand, approveAgencyMembership, requestAgencyMembership, listPendingAgencyMemberships } = await import('../../src/app/api/services/brandProfileService');
    const { brandId } = await createBrand({ uid: 'agent1', name: 'Harcourts Property Hub', primary: '#011d47' });
    state.users.agent2 = { companyName: 'Harcourts Property Hub' };
    await requestAgencyMembership({ uid: 'agent2', brandId });
    await approveAgencyMembership({ uid: 'agent2', adminUid: 'admin1' });
    state.users.agent3 = { companyName: 'No Brand At All' };

    const pending = await listPendingAgencyMemberships();
    expect(pending.map((p) => p.uid)).not.toContain('agent1');
    expect(pending.map((p) => p.uid)).not.toContain('agent2');
    expect(pending.map((p) => p.uid)).not.toContain('agent3');
  });
});

describe('findBrandByExactName — no fuzzy matching', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetState();
  });

  it('matches on exact name, case/whitespace-normalized', async () => {
    const { createBrand, findBrandByExactName } = await import('../../src/app/api/services/brandProfileService');
    await createBrand({ uid: 'agent1', name: 'Harcourts Property Hub', primary: '#011d47' });

    const match = await findBrandByExactName('  harcourts property hub  ');
    expect(match).not.toBeNull();
    expect(match.name).toBe('Harcourts Property Hub');
  });

  it('does not match a similar-but-different name (no fuzzy matching)', async () => {
    const { createBrand, findBrandByExactName } = await import('../../src/app/api/services/brandProfileService');
    await createBrand({ uid: 'agent1', name: 'Harcourts Property Hub', primary: '#011d47' });

    expect(await findBrandByExactName('Harcourts')).toBeNull();
    expect(await findBrandByExactName('Harcourts Property')).toBeNull();
    expect(await findBrandByExactName('Witheriff Group')).toBeNull();
  });

  it('returns null for empty/missing company name', async () => {
    const { findBrandByExactName } = await import('../../src/app/api/services/brandProfileService');
    expect(await findBrandByExactName('')).toBeNull();
    expect(await findBrandByExactName(null)).toBeNull();
  });
});

describe('autoEstablishBrandForUser', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetState();
  });

  // A real, extractable synthetic logo (mostly-white background with a
  // distinct dark-red mark) — reused across the "should create" tests so
  // the real (non-mocked) extractBrandColors pipeline is genuinely
  // exercised, matching this project's established testing pattern.
  async function usableLogoBuffer() {
    const sharp = (await import('sharp')).default;
    const svg = `<svg width="120" height="120" xmlns="http://www.w3.org/2000/svg">
      <rect width="120" height="120" fill="#ffffff"/>
      <rect x="20" y="20" width="80" height="80" fill="#7a1f2b"/>
    </svg>`;
    return sharp(Buffer.from(svg)).png().toBuffer();
  }

  // A logo with no extractable colour (pure black-on-white text) — used
  // to prove the automatic path declines rather than guesses.
  async function lowConfidenceLogoBuffer() {
    const sharp = (await import('sharp')).default;
    const svg = `<svg width="100" height="100" xmlns="http://www.w3.org/2000/svg">
      <rect width="100" height="100" fill="#ffffff"/>
      <text x="10" y="50" font-size="20" fill="#000000">LOGO</text>
    </svg>`;
    return sharp(Buffer.from(svg)).png().toBuffer();
  }

  it('skips (no-op) an account that already has a brand — never overwrites/reruns', async () => {
    const { autoEstablishBrandForUser } = await import('../../src/app/api/services/brandProfileService');
    state.users.agent1 = { companyName: 'Some Agency', logoUrl: 'https://example.com/logo.png', agencyBrandId: 'already-set' };
    global.fetch = vi.fn();

    const result = await autoEstablishBrandForUser('agent1');

    expect(result).toEqual({ status: 'skipped', reason: 'already-branded' });
    expect(global.fetch).not.toHaveBeenCalled();
    expect(state.users.agent1.agencyBrandId).toBe('already-set');
  });

  it('skips an account with no logoUrl — falls through to default Premarket branding', async () => {
    const { autoEstablishBrandForUser } = await import('../../src/app/api/services/brandProfileService');
    state.users.agent1 = { companyName: 'Some Agency' };

    const result = await autoEstablishBrandForUser('agent1');

    expect(result).toEqual({ status: 'skipped', reason: 'no-logo' });
    expect(state.users.agent1.agencyBrandId).toBeUndefined();
  });

  it('skips an account with no companyName, even if it has a logo', async () => {
    const { autoEstablishBrandForUser } = await import('../../src/app/api/services/brandProfileService');
    state.users.agent1 = { logoUrl: 'https://example.com/logo.png' };

    const result = await autoEstablishBrandForUser('agent1');

    expect(result).toEqual({ status: 'skipped', reason: 'no-company-name' });
  });

  it('SECURITY: no longer auto-joins an existing brand by companyName match — this used to be the unverified escalation path', async () => {
    const { createBrand, autoEstablishBrandForUser } = await import('../../src/app/api/services/brandProfileService');
    const { brandId } = await createBrand({ uid: 'agent1', name: 'Shared Agency', primary: '#011d47' });
    state.users.agent2 = { companyName: 'Shared Agency', logoUrl: 'https://example.com/logo.png' };
    global.fetch = vi.fn();

    const result = await autoEstablishBrandForUser('agent2');

    expect(result).toEqual({ status: 'existing-match-found', brandId });
    expect(state.users.agent2.agencyBrandId).toBeUndefined(); // NOT auto-linked
    expect(global.fetch).not.toHaveBeenCalled();
    expect(state.agencyMemberships.agent2).toBeUndefined(); // no request filed either — that requires an explicit agent action
  });

  it('creates a new brand from the agent\'s own logo when extraction is confident, and links their account to it', async () => {
    const { autoEstablishBrandForUser } = await import('../../src/app/api/services/brandProfileService');
    state.users.agent1 = { companyName: 'Fresh Agency', logoUrl: 'https://example.com/logo.png' };
    const buffer = await usableLogoBuffer();
    global.fetch = vi.fn().mockResolvedValue({ ok: true, arrayBuffer: async () => buffer });

    const result = await autoEstablishBrandForUser('agent1');

    expect(result.status).toBe('created');
    expect(state.users.agent1.agencyBrandId).toBe(result.brandId);
    const brand = state.agencyBrands[result.brandId];
    expect(brand.name).toBe('Fresh Agency');
    expect(brand.logoUrl).toBe('https://example.com/logo.png');
    // Contrast is always recomputed server-side, same as the manual flow.
    expect(brand.colors.primaryTextMeetsContrast).toBe(true);
    // Creating a brand no one else holds carries no identity risk — verified immediately.
    expect(state.agencyMemberships.agent1.status).toBe('verified');
  });

  it('declines (skips) rather than guessing when extraction has no confident colour', async () => {
    const { autoEstablishBrandForUser } = await import('../../src/app/api/services/brandProfileService');
    state.users.agent1 = { companyName: 'Uncertain Agency', logoUrl: 'https://example.com/logo.png' };
    const buffer = await lowConfidenceLogoBuffer();
    global.fetch = vi.fn().mockResolvedValue({ ok: true, arrayBuffer: async () => buffer });

    const result = await autoEstablishBrandForUser('agent1');

    expect(result).toEqual({ status: 'skipped', reason: 'low-confidence-extraction' });
    expect(state.users.agent1.agencyBrandId).toBeUndefined();
    expect(Object.keys(state.agencyBrands)).toHaveLength(0);
  });

  it('skips gracefully (no throw) if the logo fails to download', async () => {
    const { autoEstablishBrandForUser } = await import('../../src/app/api/services/brandProfileService');
    state.users.agent1 = { companyName: 'Broken Logo Agency', logoUrl: 'https://example.com/missing.png' };
    global.fetch = vi.fn().mockResolvedValue({ ok: false });

    const result = await autoEstablishBrandForUser('agent1');

    expect(result).toEqual({ status: 'skipped', reason: 'logo-fetch-failed' });
    expect(state.users.agent1.agencyBrandId).toBeUndefined();
  });

  it('a second agent at the same company as an auto-created brand gets a match SIGNAL only, never auto-joined', async () => {
    const { autoEstablishBrandForUser } = await import('../../src/app/api/services/brandProfileService');
    state.users.agent1 = { companyName: 'Two Agent Agency', logoUrl: 'https://example.com/logo.png' };
    const buffer = await usableLogoBuffer();
    global.fetch = vi.fn().mockResolvedValue({ ok: true, arrayBuffer: async () => buffer });

    const first = await autoEstablishBrandForUser('agent1');
    expect(first.status).toBe('created');

    // Second agent, same company, no logo of their own.
    state.users.agent2 = { companyName: 'Two Agent Agency' };
    const second = await autoEstablishBrandForUser('agent2');

    expect(second).toEqual({ status: 'existing-match-found', brandId: first.brandId });
    expect(state.users.agent2.agencyBrandId).toBeUndefined();
    expect(Object.keys(state.agencyBrands)).toHaveLength(1);
  });
});
