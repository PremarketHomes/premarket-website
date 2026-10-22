import { describe, it, expect, vi, beforeEach } from 'vitest';

const state = { users: {}, agencyBrands: {}, offices: {} };

function makeCollection(name) {
  return {
    doc: (id) => ({
      get: vi.fn().mockImplementation(async () => (
        state[name][id] ? { exists: true, data: () => state[name][id] } : { exists: false }
      )),
      set: vi.fn().mockImplementation(async (data) => { state[name][id] = data; }),
      update: vi.fn().mockImplementation(async (patch) => {
        state[name][id] = { ...(state[name][id] || {}) };
        for (const [key, value] of Object.entries(patch)) {
          if (value === 'DELETE_SENTINEL') delete state[name][id][key];
          else state[name][id][key] = value;
        }
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
      if (!['users', 'agencyBrands', 'offices'].includes(name)) {
        throw new Error(`Unexpected collection in test: ${name}`);
      }
      return makeCollection(name);
    },
  },
}));

vi.mock('firebase-admin/firestore', () => ({
  FieldValue: { serverTimestamp: () => 'TIMESTAMP', delete: () => 'DELETE_SENTINEL' },
}));

function resetState() {
  state.users = {};
  state.agencyBrands = {};
  state.offices = {};
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

  it('creates a brand and links only the confirming user\'s account', async () => {
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

    const resolved = await getBrandForUser('agent1');
    expect(resolved.name).toBe('Harcourts Property Hub');
  });

  it('SECURITY: an ordinary agent cannot "create" a brand with an EXISTING agency\'s exact name — createdBy, logo and colours stay the real creator\'s', async () => {
    const { createBrand } = await import('../../src/app/api/services/brandProfileService');
    await createBrand({ uid: 'realCreator', name: 'Harcourts Property Hub', logoUrl: 'https://real.example.com/logo.png', primary: '#011d47' });
    const brandIdBefore = Object.keys(state.agencyBrands)[0];
    const brandBefore = { ...state.agencyBrands[brandIdBefore] };

    // Under the no-approval model, submitting the identical name is no
    // longer an error at all — it's a silent auto-join (see the race
    // test below) — but the REAL brand document must still be
    // completely untouched by it, same guarantee as before.
    const result = await createBrand({
      uid: 'secondAgent', name: 'Harcourts Property Hub', logoUrl: 'https://attacker.example.com/evil.png', primary: '#ff0000',
    });

    expect(result.brandId).toBe(brandIdBefore);
    expect(result.joinedExisting).toBe(true);
    expect(state.agencyBrands[brandIdBefore]).toEqual(brandBefore);
    expect(state.agencyBrands[brandIdBefore].createdBy).toBe('realCreator');
    expect(state.agencyBrands[brandIdBefore].logoUrl).toBe('https://real.example.com/logo.png');
    // The second agent is simply joined — their own submitted logo/colours never land anywhere.
    expect(state.users.secondAgent.agencyBrandId).toBe(brandIdBefore);
  });

  it('SECURITY: alternate spellings/punctuation that normalise to the SAME slug join the real brand rather than erroring or overwriting it', async () => {
    const { createBrand } = await import('../../src/app/api/services/brandProfileService');
    await createBrand({ uid: 'realCreator', name: 'Harcourts Property Hub', primary: '#011d47' });

    // Different raw string, same slugified id.
    const result = await createBrand({ uid: 'secondAgent', name: '  Harcourts   Property -- Hub!!', primary: '#ff0000' });
    expect(result.joinedExisting).toBe(true);
    expect(state.agencyBrands['harcourts-property-hub'].createdBy).toBe('realCreator');
    expect(state.users.secondAgent.agencyBrandId).toBe('harcourts-property-hub');
  });

  it('of two simultaneous creation requests for the same agency name, exactly one creates and the other silently joins it — never two brands, never an overwrite, never an error', async () => {
    const { createBrand } = await import('../../src/app/api/services/brandProfileService');

    const results = await Promise.allSettled([
      createBrand({ uid: 'agentA', name: 'Simultaneous Agency', primary: '#011d47' }),
      createBrand({ uid: 'agentB', name: 'Simultaneous Agency', primary: '#ff0000' }),
    ]);

    // No approval step means no error is ever surfaced for this race.
    expect(results.every((r) => r.status === 'fulfilled')).toBe(true);

    // Exactly one brand document exists, and BOTH agents end up linked to it.
    expect(Object.keys(state.agencyBrands)).toHaveLength(1);
    const brandId = Object.keys(state.agencyBrands)[0];
    expect(state.users.agentA.agencyBrandId).toBe(brandId);
    expect(state.users.agentB.agencyBrandId).toBe(brandId);

    const joinedCount = results.filter((r) => r.value.joinedExisting).length;
    expect(joinedCount).toBe(1); // exactly one of the two lost the race and joined
  });

  it('a genuinely new, non-colliding brand name still creates successfully (the fix only blocks real collisions)', async () => {
    const { createBrand } = await import('../../src/app/api/services/brandProfileService');
    const result = await createBrand({ uid: 'agent1', name: 'Totally Unique Agency Name', primary: '#011d47' });
    expect(result.brandId).toBeTruthy();
    expect(result.joinedExisting).toBeUndefined();
    expect(state.agencyBrands[result.brandId].createdBy).toBe('agent1');
  });

  it('getBrandForUser returns null for an account with no agencyBrandId (existing agents, unaffected)', async () => {
    state.users.agent2 = { name: 'Existing Agent' };
    const { getBrandForUser } = await import('../../src/app/api/services/brandProfileService');
    expect(await getBrandForUser('agent2')).toBeNull();
  });
});

describe('findBrandByExactName — exact match only, no fuzzy/franchise grouping', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetState();
  });

  it('matches on exact name, case-normalized', async () => {
    const { createBrand, findBrandByExactName } = await import('../../src/app/api/services/brandProfileService');
    await createBrand({ uid: 'agent1', name: 'Harcourts Property Hub', primary: '#011d47' });

    const match = await findBrandByExactName('HARCOURTS PROPERTY HUB');
    expect(match).not.toBeNull();
    expect(match.name).toBe('Harcourts Property Hub');
  });

  it('matches ignoring leading/trailing and repeated internal whitespace', async () => {
    const { createBrand, findBrandByExactName } = await import('../../src/app/api/services/brandProfileService');
    await createBrand({ uid: 'agent1', name: 'Harcourts Property Hub', primary: '#011d47' });

    expect(await findBrandByExactName('  Harcourts Property Hub  ')).not.toBeNull();
    expect((await findBrandByExactName('Harcourts  Property   Hub'))?.name).toBe('Harcourts Property Hub');
  });

  it('does not match a similar-but-different name (no fuzzy matching, no franchise-level grouping)', async () => {
    const { createBrand, findBrandByExactName } = await import('../../src/app/api/services/brandProfileService');
    await createBrand({ uid: 'agent1', name: 'Ray White Brisbane', primary: '#011d47' });

    expect(await findBrandByExactName('Ray White')).toBeNull();
    expect(await findBrandByExactName('Ray White Gold Coast')).toBeNull();
    expect(await findBrandByExactName('Witheriff Group')).toBeNull();
  });

  it('returns null for empty/missing company name', async () => {
    const { findBrandByExactName } = await import('../../src/app/api/services/brandProfileService');
    expect(await findBrandByExactName('')).toBeNull();
    expect(await findBrandByExactName(null)).toBeNull();
  });
});

describe('autoEstablishBrandForUser — automatic, no approval', () => {
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

  it('skips an account with no logoUrl and no existing match — falls through to default Premarket branding', async () => {
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

  it('CORE RULE: automatically JOINS an existing brand on an exact companyName match — no click, no review', async () => {
    const { createBrand, autoEstablishBrandForUser } = await import('../../src/app/api/services/brandProfileService');
    const { brandId } = await createBrand({ uid: 'agent1', name: 'Shared Agency', primary: '#011d47' });
    state.users.agent2 = { companyName: 'Shared Agency', logoUrl: 'https://example.com/logo.png' };
    global.fetch = vi.fn();

    const result = await autoEstablishBrandForUser('agent2');

    expect(result).toEqual({ status: 'joined', brandId });
    expect(state.users.agent2.agencyBrandId).toBe(brandId); // automatically linked, no agent action
    expect(global.fetch).not.toHaveBeenCalled(); // never bothers extracting from their own logo once a match is found
  });

  it('whitespace/case variations of the same agency name still auto-join', async () => {
    const { createBrand, autoEstablishBrandForUser } = await import('../../src/app/api/services/brandProfileService');
    const { brandId } = await createBrand({ uid: 'agent1', name: 'Harcourts Property Hub', primary: '#011d47' });
    state.users.agent2 = { companyName: '  harcourts   property hub ' };

    const result = await autoEstablishBrandForUser('agent2');
    expect(result).toEqual({ status: 'joined', brandId });
  });

  it('a different office name never auto-joins, even if it shares a franchise prefix', async () => {
    const { createBrand, autoEstablishBrandForUser } = await import('../../src/app/api/services/brandProfileService');
    await createBrand({ uid: 'agent1', name: 'Ray White Brisbane', primary: '#011d47' });
    state.users.agent2 = { companyName: 'Ray White Gold Coast' };

    const result = await autoEstablishBrandForUser('agent2');
    expect(result.status).not.toBe('joined');
    expect(state.users.agent2.agencyBrandId).toBeUndefined();
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

  it('a second agent at the same company as an auto-created brand is automatically joined, even with no logo of their own', async () => {
    const { autoEstablishBrandForUser } = await import('../../src/app/api/services/brandProfileService');
    state.users.agent1 = { companyName: 'Two Agent Agency', logoUrl: 'https://example.com/logo.png' };
    const buffer = await usableLogoBuffer();
    global.fetch = vi.fn().mockResolvedValue({ ok: true, arrayBuffer: async () => buffer });

    const first = await autoEstablishBrandForUser('agent1');
    expect(first.status).toBe('created');

    // Second agent, same company, no logo of their own.
    state.users.agent2 = { companyName: 'Two Agent Agency' };
    const second = await autoEstablishBrandForUser('agent2');

    expect(second).toEqual({ status: 'joined', brandId: first.brandId });
    expect(state.users.agent2.agencyBrandId).toBe(first.brandId);
    expect(Object.keys(state.agencyBrands)).toHaveLength(1); // never a second brand created
  });
});

describe('setPersonalBrandOverride — never touches the shared brand or any other agent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetState();
  });

  it('sets a personal logo + colour override on the caller\'s own doc only', async () => {
    const { createBrand, setPersonalBrandOverride } = await import('../../src/app/api/services/brandProfileService');
    const { brandId } = await createBrand({ uid: 'agent1', name: 'Shared Agency', logoUrl: 'https://shared.example.com/logo.png', primary: '#011d47' });
    state.users.agent2 = { companyName: 'Shared Agency', agencyBrandId: brandId };

    await setPersonalBrandOverride({ uid: 'agent2', logoUrl: 'https://mine.example.com/logo.png', primary: '#ff0000' });

    expect(state.users.agent2.logoUrl).toBe('https://mine.example.com/logo.png');
    expect(state.users.agent2.brandColors.primary).toBe('#ff0000');
    // The shared brand itself, and the brand's own creator, are completely untouched.
    expect(state.agencyBrands[brandId].logoUrl).toBe('https://shared.example.com/logo.png');
    expect(state.agencyBrands[brandId].colors.primary).toBe('#011d47');
    expect(state.users.agent1.logoUrl).toBeUndefined();
  });

  it('works for an agent with NO shared brand at all — a personal override has no dependency on agencyBrandId', async () => {
    const { setPersonalBrandOverride } = await import('../../src/app/api/services/brandProfileService');
    state.users.agent1 = { companyName: 'Nobody Else Here' };

    await setPersonalBrandOverride({ uid: 'agent1', logoUrl: 'https://mine.example.com/logo.png', primary: '#ff0000' });

    expect(state.users.agent1.logoUrl).toBe('https://mine.example.com/logo.png');
    expect(state.users.agent1.brandColors.primary).toBe('#ff0000');
    expect(state.users.agent1.agencyBrandId).toBeUndefined();
  });

  it('logo and colour are independently overridable — setting one never touches the other', async () => {
    const { setPersonalBrandOverride } = await import('../../src/app/api/services/brandProfileService');
    state.users.agent1 = { brandColors: { primary: '#011d47' } };

    await setPersonalBrandOverride({ uid: 'agent1', logoUrl: 'https://mine.example.com/logo.png' });

    expect(state.users.agent1.logoUrl).toBe('https://mine.example.com/logo.png');
    expect(state.users.agent1.brandColors.primary).toBe('#011d47'); // untouched — no primary was supplied this call
  });

  it('REQUIREMENT 8: never erases unrelated profile fields — uses a minimal field-only update', async () => {
    const { setPersonalBrandOverride } = await import('../../src/app/api/services/brandProfileService');
    state.users.agent1 = { firstName: 'Jo', lastName: 'Lee', companyName: 'Some Agency', email: 'jo@example.com' };

    await setPersonalBrandOverride({ uid: 'agent1', primary: '#ff0000' });

    expect(state.users.agent1.firstName).toBe('Jo');
    expect(state.users.agent1.lastName).toBe('Lee');
    expect(state.users.agent1.companyName).toBe('Some Agency');
    expect(state.users.agent1.email).toBe('jo@example.com');
  });

  it('rejects an invalid primary colour rather than saving something broken', async () => {
    const { setPersonalBrandOverride } = await import('../../src/app/api/services/brandProfileService');
    state.users.agent1 = {};
    await expect(setPersonalBrandOverride({ uid: 'agent1', primary: 'not-a-colour' })).rejects.toThrow();
  });

  it('rejects a call with neither a logo nor a colour — nothing to save', async () => {
    const { setPersonalBrandOverride } = await import('../../src/app/api/services/brandProfileService');
    state.users.agent1 = {};
    await expect(setPersonalBrandOverride({ uid: 'agent1' })).rejects.toThrow();
  });
});

describe('resetPersonalBrandOverride — falls back to the shared default, never touches agencyBrandId', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetState();
  });

  it('clears both logoUrl and brandColors, leaving agencyBrandId and other fields untouched', async () => {
    const { resetPersonalBrandOverride } = await import('../../src/app/api/services/brandProfileService');
    state.users.agent1 = {
      firstName: 'Jo',
      companyName: 'Shared Agency',
      agencyBrandId: 'shared-agency',
      logoUrl: 'https://mine.example.com/logo.png',
      brandColors: { primary: '#ff0000' },
    };

    await resetPersonalBrandOverride({ uid: 'agent1' });

    expect(state.users.agent1.logoUrl).toBeUndefined();
    expect(state.users.agent1.brandColors).toBeUndefined();
    expect(state.users.agent1.agencyBrandId).toBe('shared-agency'); // the shared-brand LINK itself is untouched
    expect(state.users.agent1.firstName).toBe('Jo');
    expect(state.users.agent1.companyName).toBe('Shared Agency');
  });

  it('is safe to call even with nothing to reset', async () => {
    const { resetPersonalBrandOverride } = await import('../../src/app/api/services/brandProfileService');
    state.users.agent1 = { agencyBrandId: 'shared-agency' };
    await expect(resetPersonalBrandOverride({ uid: 'agent1' })).resolves.toEqual({ uid: 'agent1', reset: true });
  });
});

describe('office integration — end-to-end branding resolution (confirms officeService + brandProfileService actually work together)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetState();
  });

  it('an office MEMBER (not just the admin) resolves branding from offices/{officeId}.agencyBrandId, never their own agencyBrandId', async () => {
    const { getBrandForUser } = await import('../../src/app/api/services/brandProfileService');
    state.offices.office1 = { agencyBrandId: 'harcourts-brand' };
    state.agencyBrands['harcourts-brand'] = { name: 'Harcourts Property Hub', colors: { primary: '#011d47' } };
    state.users.member1 = { officeId: 'office1' }; // never has agencyBrandId set directly

    const brand = await getBrandForUser('member1');
    expect(brand.name).toBe('Harcourts Property Hub');
  });

  it('createBrand with an officeId targets the OFFICE doc, and every member immediately resolves it via getBrandForUser', async () => {
    const { createBrand, getBrandForUser } = await import('../../src/app/api/services/brandProfileService');
    state.offices.office1 = { agencyBrandId: null };
    state.users.member1 = { officeId: 'office1' };
    state.users.member2 = { officeId: 'office1' };

    const { brandId } = await createBrand({ uid: 'admin1', name: 'Harcourts Property Hub', primary: '#011d47', officeId: 'office1' });

    expect(state.offices.office1.agencyBrandId).toBe(brandId);
    expect(state.users.admin1).toBeUndefined(); // the admin's OWN doc was never touched
    expect((await getBrandForUser('member1')).name).toBe('Harcourts Property Hub');
    expect((await getBrandForUser('member2')).name).toBe('Harcourts Property Hub');
  });

  it('removing an agent from their office (officeId cleared) instantly drops the office branding — falls back to Premarket default with nothing to clean up', async () => {
    const { getBrandForUser } = await import('../../src/app/api/services/brandProfileService');
    state.offices.office1 = { agencyBrandId: 'harcourts-brand' };
    state.agencyBrands['harcourts-brand'] = { name: 'Harcourts Property Hub', colors: { primary: '#011d47' } };
    state.users.member1 = { officeId: 'office1' };

    expect((await getBrandForUser('member1')).name).toBe('Harcourts Property Hub');

    delete state.users.member1.officeId; // simulates removeAgentFromOffice's own officeId: FieldValue.delete()

    expect(await getBrandForUser('member1')).toBeNull();
  });

  it('a personal override still wins for an office member, exactly like it does for an independent agent', async () => {
    const { getBrandForUser } = await import('../../src/app/api/services/brandProfileService');
    const { computeEffectiveColors } = await import('../../src/app/utils/brandStyle');
    state.offices.office1 = { agencyBrandId: 'harcourts-brand' };
    state.agencyBrands['harcourts-brand'] = { name: 'Harcourts Property Hub', colors: { primary: '#011d47' } };
    state.users.member1 = { officeId: 'office1', brandColors: { primary: '#ff0000' } };

    const brand = await getBrandForUser('member1'); // the shared office brand, unaffected by the override
    expect(brand.colors.primary).toBe('#011d47');

    // The override only applies at the LAST resolution step, exactly
    // as it already does for independent agents — brandProfileService
    // never needs to know about it.
    const effective = computeEffectiveColors({ brand, agentData: state.users.member1 });
    expect(effective.primary).toBe('#ff0000');
  });

  it('autoEstablishBrandForUser (exact-name text matching) never runs for an office member, even if their companyName happens to match an unrelated brand', async () => {
    const { autoEstablishBrandForUser } = await import('../../src/app/api/services/brandProfileService');
    state.agencyBrands['coincidence'] = { name: 'Harcourts Property Hub', colors: { primary: '#000000' } };
    state.users.member1 = { officeId: 'office1', companyName: 'Harcourts Property Hub' };

    const result = await autoEstablishBrandForUser('member1');
    expect(result).toEqual({ status: 'skipped', reason: 'office-member' });
    expect(state.users.member1.agencyBrandId).toBeUndefined();
  });

  it('an office with no agencyBrandId set yet simply resolves to no shared brand — never falls back to text-matching', async () => {
    const { getBrandForUser } = await import('../../src/app/api/services/brandProfileService');
    state.offices.office1 = { agencyBrandId: null };
    state.users.member1 = { officeId: 'office1', companyName: 'Some Agency Name' };
    expect(await getBrandForUser('member1')).toBeNull();
  });
});
