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
