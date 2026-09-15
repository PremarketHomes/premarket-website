import { describe, it, expect, vi, beforeEach } from 'vitest';

const state = { users: {}, agencyBrands: {} };

vi.mock('../../src/app/firebase/adminApp', () => ({
  adminDb: {
    collection: (name) => {
      if (name === 'users') {
        return {
          doc: (id) => ({
            get: vi.fn().mockImplementation(async () => (
              state.users[id] ? { exists: true, data: () => state.users[id] } : { exists: false }
            )),
            update: vi.fn().mockImplementation(async (patch) => {
              state.users[id] = { ...(state.users[id] || {}), ...patch };
            }),
          }),
        };
      }
      if (name === 'agencyBrands') {
        return {
          doc: (id) => ({
            get: vi.fn().mockImplementation(async () => (
              state.agencyBrands[id] ? { exists: true, data: () => state.agencyBrands[id] } : { exists: false }
            )),
            set: vi.fn().mockImplementation(async (data) => { state.agencyBrands[id] = data; }),
          }),
          where: () => ({
            get: vi.fn().mockImplementation(async () => ({
              docs: Object.entries(state.agencyBrands).map(([id, data]) => ({ id, data: () => data })),
            })),
          }),
        };
      }
      throw new Error(`Unexpected collection in test: ${name}`);
    },
  },
}));

vi.mock('firebase-admin/firestore', () => ({
  FieldValue: { serverTimestamp: () => 'TIMESTAMP' },
}));

function resetState() {
  state.users = {};
  state.agencyBrands = {};
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

describe('createBrand / getBrandForUser / linkExistingBrand', () => {
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

  it('getBrandForUser returns null for an account with no agencyBrandId (existing agents, unaffected)', async () => {
    state.users.agent2 = { name: 'Existing Agent' };
    const { getBrandForUser } = await import('../../src/app/api/services/brandProfileService');
    expect(await getBrandForUser('agent2')).toBeNull();
  });

  it('linkExistingBrand connects a second agent to an already-created brand without touching the first agent, when their companyName matches', async () => {
    const { createBrand, linkExistingBrand } = await import('../../src/app/api/services/brandProfileService');
    const { brandId } = await createBrand({ uid: 'agent1', name: 'Harcourts Property Hub', primary: '#011d47' });
    state.users.agent2 = { companyName: 'Harcourts Property Hub' };

    await linkExistingBrand({ uid: 'agent2', brandId });

    expect(state.users.agent2.agencyBrandId).toBe(brandId);
    expect(state.users.agent1.agencyBrandId).toBe(brandId); // untouched, still correct
  });

  it('linkExistingBrand rejects an unknown brandId', async () => {
    state.users.agent1 = { companyName: 'Anything' };
    const { linkExistingBrand } = await import('../../src/app/api/services/brandProfileService');
    await expect(linkExistingBrand({ uid: 'agent1', brandId: 'does-not-exist' })).rejects.toThrow();
    expect(state.users.agent1.agencyBrandId).toBeUndefined();
  });

  it('linkExistingBrand rejects a join whose companyName does not match the brand (no self-assigning another agency\'s brand)', async () => {
    const { createBrand, linkExistingBrand } = await import('../../src/app/api/services/brandProfileService');
    const { brandId } = await createBrand({ uid: 'agent1', name: 'Harcourts Property Hub', primary: '#011d47' });
    state.users.agent2 = { companyName: 'Some Rival Agency' };

    await expect(linkExistingBrand({ uid: 'agent2', brandId })).rejects.toThrow();
    expect(state.users.agent2.agencyBrandId).toBeUndefined();
  });

  it('linkExistingBrand rejects a join when the agent has no companyName at all', async () => {
    const { createBrand, linkExistingBrand } = await import('../../src/app/api/services/brandProfileService');
    const { brandId } = await createBrand({ uid: 'agent1', name: 'Harcourts Property Hub', primary: '#011d47' });
    state.users.agent2 = {};

    await expect(linkExistingBrand({ uid: 'agent2', brandId })).rejects.toThrow();
    expect(state.users.agent2.agencyBrandId).toBeUndefined();
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

  it('links to an already-existing brand by exact company-name match, rather than creating a duplicate', async () => {
    const { createBrand, autoEstablishBrandForUser } = await import('../../src/app/api/services/brandProfileService');
    const { brandId } = await createBrand({ uid: 'agent1', name: 'Shared Agency', primary: '#011d47' });
    state.users.agent2 = { companyName: 'Shared Agency', logoUrl: 'https://example.com/logo.png' };
    global.fetch = vi.fn(); // must never be called — no extraction needed when reusing an existing brand

    const result = await autoEstablishBrandForUser('agent2');

    expect(result).toEqual({ status: 'linked', brandId });
    expect(state.users.agent2.agencyBrandId).toBe(brandId);
    expect(global.fetch).not.toHaveBeenCalled();
    // The original agent's account and brand are untouched.
    expect(state.users.agent1.agencyBrandId).toBe(brandId);
    expect(Object.keys(state.agencyBrands)).toHaveLength(1);
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

  it('a second agent at the same company as an auto-created brand automatically joins it (no duplicate)', async () => {
    const { autoEstablishBrandForUser } = await import('../../src/app/api/services/brandProfileService');
    state.users.agent1 = { companyName: 'Two Agent Agency', logoUrl: 'https://example.com/logo.png' };
    const buffer = await usableLogoBuffer();
    global.fetch = vi.fn().mockResolvedValue({ ok: true, arrayBuffer: async () => buffer });

    const first = await autoEstablishBrandForUser('agent1');
    expect(first.status).toBe('created');

    // Second agent, same company, no logo of their own.
    state.users.agent2 = { companyName: 'Two Agent Agency' };
    const second = await autoEstablishBrandForUser('agent2');

    expect(second).toEqual({ status: 'linked', brandId: first.brandId });
    expect(state.users.agent2.agencyBrandId).toBe(first.brandId);
    expect(Object.keys(state.agencyBrands)).toHaveLength(1);
  });
});
