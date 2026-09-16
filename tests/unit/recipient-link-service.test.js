import { describe, it, expect, vi, beforeEach } from 'vitest';

const state = { properties: {}, recipients: {}, recipientLinks: {}, recipientEngagement: {} };
let autoIdCounter = 0;

function applyIncrementPatch(target, patch) {
  for (const [key, value] of Object.entries(patch)) {
    if (value && value.__op === 'increment') {
      target[key] = (target[key] || 0) + value.n;
    } else {
      target[key] = value;
    }
  }
}

function makeDocRef(collectionName, id) {
  const store = state[collectionName];
  return {
    id,
    get: vi.fn(async () => (store[id] ? { exists: true, id, data: () => store[id] } : { exists: false, id })),
    set: vi.fn(async (data, opts) => {
      const current = (opts?.merge && store[id]) || {};
      const merged = { ...current };
      applyIncrementPatch(merged, data);
      store[id] = merged;
    }),
  };
}

function makeQuery(collectionName, filters) {
  return {
    where: (field, op, value) => makeQuery(collectionName, [...filters, { field, value }]),
    limit: (n) => ({
      get: vi.fn(async () => {
        const store = state[collectionName];
        const matches = Object.entries(store).filter(([, data]) => filters.every((f) => data[f.field] === f.value));
        const docs = matches.slice(0, n).map(([id, data]) => ({ id, data: () => data, ref: makeDocRef(collectionName, id) }));
        return { empty: docs.length === 0, docs };
      }),
    }),
    get: vi.fn(async () => {
      const store = state[collectionName];
      const matches = Object.entries(store).filter(([, data]) => filters.every((f) => data[f.field] === f.value));
      const docs = matches.map(([id, data]) => ({ id, data: () => data, ref: makeDocRef(collectionName, id) }));
      return { empty: docs.length === 0, docs };
    }),
  };
}

function makeCollection(name) {
  return {
    doc: (id) => makeDocRef(name, id || `auto_${++autoIdCounter}`),
    where: (field, op, value) => makeQuery(name, [{ field, value }]),
    get: vi.fn(async () => {
      const store = state[name];
      const docs = Object.entries(store).map(([id, data]) => ({ id, data: () => data }));
      return { empty: docs.length === 0, docs };
    }),
  };
}

vi.mock('../../src/app/firebase/adminApp', () => ({
  adminDb: {
    collection: (name) => makeCollection(name),
    batch: () => {
      const ops = [];
      return {
        set: (ref, data) => ops.push({ ref, data }),
        commit: vi.fn(async () => {
          for (const { ref, data } of ops) {
            await ref.set(data, {});
          }
        }),
      };
    },
    runTransaction: vi.fn(async (fn) => {
      const tx = {
        get: (ref) => ref.get(),
        set: (ref, data, opts) => { ref.set(data, opts); },
      };
      return fn(tx);
    }),
  },
}));

vi.mock('firebase-admin/firestore', () => ({
  FieldValue: {
    serverTimestamp: () => 'TIMESTAMP',
    increment: (n) => ({ __op: 'increment', n }),
  },
  Timestamp: {
    fromDate: (d) => ({ __isTimestamp: true, toDate: () => d }),
  },
}));

function resetState() {
  state.properties = {};
  state.recipients = {};
  state.recipientLinks = {};
  state.recipientEngagement = {};
  autoIdCounter = 0;
}

describe('recipientLinkService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetState();
  });

  describe('generateRecipientToken', () => {
    it('produces a unique, opaque, URL-safe token with an rl_ prefix', async () => {
      const { generateRecipientToken } = await import('../../src/app/api/services/recipientLinkService');
      const a = generateRecipientToken();
      const b = generateRecipientToken();
      expect(a).toMatch(/^rl_[a-f0-9]{48}$/);
      expect(a).not.toEqual(b);
      // No PII, no predictable sequence, no property/recipient id embedded.
      expect(a).not.toContain('@');
    });
  });

  describe('findOrCreateRecipient', () => {
    it('creates a new recipient when none exists for this agent+email', async () => {
      const { findOrCreateRecipient } = await import('../../src/app/api/services/recipientLinkService');
      const id = await findOrCreateRecipient({ agencyOwnerId: 'agent1', name: 'Luke Wilson', email: 'Luke@Example.com' });
      expect(state.recipients[id]).toMatchObject({ name: 'Luke Wilson', email: 'luke@example.com', agencyOwnerId: 'agent1' });
    });

    it('reuses the existing recipient for the same agent + email (dedup)', async () => {
      const { findOrCreateRecipient } = await import('../../src/app/api/services/recipientLinkService');
      const id1 = await findOrCreateRecipient({ agencyOwnerId: 'agent1', name: 'Luke Wilson', email: 'luke@example.com' });
      const id2 = await findOrCreateRecipient({ agencyOwnerId: 'agent1', name: 'Luke Wilson', email: 'luke@example.com' });
      expect(id1).toBe(id2);
      expect(Object.keys(state.recipients)).toHaveLength(1);
    });

    it('does not dedup across two different agents with the same buyer email', async () => {
      const { findOrCreateRecipient } = await import('../../src/app/api/services/recipientLinkService');
      const id1 = await findOrCreateRecipient({ agencyOwnerId: 'agent1', email: 'luke@example.com' });
      const id2 = await findOrCreateRecipient({ agencyOwnerId: 'agent2', email: 'luke@example.com' });
      expect(id1).not.toBe(id2);
    });

    it('fills in a missing field on the existing record rather than creating a duplicate, but never blanks an existing value', async () => {
      const { findOrCreateRecipient } = await import('../../src/app/api/services/recipientLinkService');
      const id = await findOrCreateRecipient({ agencyOwnerId: 'agent1', email: 'luke@example.com' });
      await findOrCreateRecipient({ agencyOwnerId: 'agent1', email: 'luke@example.com', mobile: '0400000000' });
      expect(state.recipients[id].mobile).toBe('0400000000');

      await findOrCreateRecipient({ agencyOwnerId: 'agent1', email: 'luke@example.com', mobile: undefined, name: undefined });
      expect(state.recipients[id].mobile).toBe('0400000000');
    });

    it('creates a new record every time for a name-only recipient (no email to dedup on)', async () => {
      const { findOrCreateRecipient } = await import('../../src/app/api/services/recipientLinkService');
      const id1 = await findOrCreateRecipient({ agencyOwnerId: 'agent1', name: 'Anonymous Contact' });
      const id2 = await findOrCreateRecipient({ agencyOwnerId: 'agent1', name: 'Anonymous Contact' });
      expect(id1).not.toBe(id2);
    });
  });

  describe('createRecipientLinksForProperty', () => {
    it('throws when the property does not exist', async () => {
      const { createRecipientLinksForProperty } = await import('../../src/app/api/services/recipientLinkService');
      await expect(
        createRecipientLinksForProperty({ propertyId: 'missing', createdBy: 'admin1', recipients: [{ email: 'a@example.com' }], baseUrl: 'https://premarket.homes' })
      ).rejects.toThrow('PROPERTY_NOT_FOUND');
    });

    it('creates one link per recipient, batched, each resolving to the property\'s own agencyOwnerId', async () => {
      state.properties.propA = { userId: 'agent1' };
      const { createRecipientLinksForProperty } = await import('../../src/app/api/services/recipientLinkService');
      const links = await createRecipientLinksForProperty({
        propertyId: 'propA',
        createdBy: 'admin1',
        recipients: [{ name: 'Luke Wilson', email: 'luke@example.com' }, { name: 'Sarah Smith', email: 'sarah@example.com' }],
        isTest: true,
        baseUrl: 'https://premarket.homes',
      });
      expect(links).toHaveLength(2);
      expect(new Set(links.map((l) => l.token)).size).toBe(2);
      for (const link of links) {
        expect(state.recipientLinks[link.token]).toMatchObject({ propertyId: 'propA', agencyOwnerId: 'agent1', revoked: false, isTest: true });
        expect(link.url).toBe(`https://premarket.homes/find-property?propertyId=propA&rlt=${link.token}`);
      }
    });
  });

  describe('resolveRecipientToken', () => {
    beforeEach(() => {
      state.recipientLinks.tok1 = { recipientId: 'rec1', propertyId: 'propA', agencyOwnerId: 'agent1', revoked: false };
    });

    it('resolves a valid token for the correct property', async () => {
      const { resolveRecipientToken } = await import('../../src/app/api/services/recipientLinkService');
      const result = await resolveRecipientToken('tok1', 'propA');
      expect(result).toEqual({ recipientId: 'rec1', propertyId: 'propA', agencyOwnerId: 'agent1' });
    });

    it('returns null for an unknown token', async () => {
      const { resolveRecipientToken } = await import('../../src/app/api/services/recipientLinkService');
      expect(await resolveRecipientToken('does-not-exist', 'propA')).toBeNull();
    });

    it('returns null for a malformed/empty token', async () => {
      const { resolveRecipientToken } = await import('../../src/app/api/services/recipientLinkService');
      expect(await resolveRecipientToken('', 'propA')).toBeNull();
      expect(await resolveRecipientToken(null, 'propA')).toBeNull();
      expect(await resolveRecipientToken(undefined, 'propA')).toBeNull();
    });

    it('returns null when the token is used against a different property than it was issued for', async () => {
      const { resolveRecipientToken } = await import('../../src/app/api/services/recipientLinkService');
      expect(await resolveRecipientToken('tok1', 'some-other-property')).toBeNull();
    });

    it('returns null for a revoked token', async () => {
      state.recipientLinks.tok1.revoked = true;
      const { resolveRecipientToken } = await import('../../src/app/api/services/recipientLinkService');
      expect(await resolveRecipientToken('tok1', 'propA')).toBeNull();
    });
  });

  describe('recordRecipientEngagement', () => {
    it('first attributed open sets firstViewedAt/lastViewedAt and starts session 1', async () => {
      const { recordRecipientEngagement } = await import('../../src/app/api/services/recipientLinkService');
      const now = new Date('2026-01-01T08:00:00Z');
      await recordRecipientEngagement({ propertyId: 'propA', recipientId: 'rec1', agencyOwnerId: 'agent1', scannerSuspected: false, now });

      const doc = state.recipientEngagement['propA_rec1'];
      expect(doc.attributableOpens).toBe(1);
      expect(doc.meaningfulSessionCount).toBe(1);
      expect(doc.firstViewedAt.toDate()).toEqual(now);
    });

    it('a second open within the inactivity window stays in the same session', async () => {
      const { recordRecipientEngagement } = await import('../../src/app/api/services/recipientLinkService');
      await recordRecipientEngagement({ propertyId: 'propA', recipientId: 'rec1', agencyOwnerId: 'agent1', scannerSuspected: false, now: new Date('2026-01-01T08:00:00Z') });
      await recordRecipientEngagement({ propertyId: 'propA', recipientId: 'rec1', agencyOwnerId: 'agent1', scannerSuspected: false, now: new Date('2026-01-01T08:02:00Z') });

      const doc = state.recipientEngagement['propA_rec1'];
      expect(doc.attributableOpens).toBe(2);
      expect(doc.meaningfulSessionCount).toBe(1);
    });

    it('an open after the inactivity window starts a new meaningful session', async () => {
      const { recordRecipientEngagement } = await import('../../src/app/api/services/recipientLinkService');
      await recordRecipientEngagement({ propertyId: 'propA', recipientId: 'rec1', agencyOwnerId: 'agent1', scannerSuspected: false, now: new Date('2026-01-01T08:00:00Z') });
      await recordRecipientEngagement({ propertyId: 'propA', recipientId: 'rec1', agencyOwnerId: 'agent1', scannerSuspected: false, now: new Date('2026-01-01T08:25:00Z') });

      const doc = state.recipientEngagement['propA_rec1'];
      expect(doc.attributableOpens).toBe(2);
      expect(doc.meaningfulSessionCount).toBe(2);
    });

    it('recipient A and recipient B on the same property are tracked completely separately', async () => {
      const { recordRecipientEngagement } = await import('../../src/app/api/services/recipientLinkService');
      const t0 = new Date('2026-01-01T08:00:00Z');
      // Recipient A: 3 opens across two sessions
      await recordRecipientEngagement({ propertyId: 'propA', recipientId: 'recA', agencyOwnerId: 'agent1', scannerSuspected: false, now: t0 });
      await recordRecipientEngagement({ propertyId: 'propA', recipientId: 'recA', agencyOwnerId: 'agent1', scannerSuspected: false, now: new Date(t0.getTime() + 2 * 60000) });
      await recordRecipientEngagement({ propertyId: 'propA', recipientId: 'recA', agencyOwnerId: 'agent1', scannerSuspected: false, now: new Date(t0.getTime() + 25 * 60000) });
      // Recipient B: 1 open
      await recordRecipientEngagement({ propertyId: 'propA', recipientId: 'recB', agencyOwnerId: 'agent1', scannerSuspected: false, now: t0 });

      expect(state.recipientEngagement['propA_recA']).toMatchObject({ attributableOpens: 3, meaningfulSessionCount: 2 });
      expect(state.recipientEngagement['propA_recB']).toMatchObject({ attributableOpens: 1, meaningfulSessionCount: 1 });
    });

    it('a scanner-suspected attributed open is recorded but excluded from opens/sessions', async () => {
      const { recordRecipientEngagement } = await import('../../src/app/api/services/recipientLinkService');
      await recordRecipientEngagement({ propertyId: 'propA', recipientId: 'rec1', agencyOwnerId: 'agent1', scannerSuspected: true, now: new Date() });

      const doc = state.recipientEngagement['propA_rec1'];
      expect(doc.scannerSuspectedOpens).toBe(1);
      expect(doc.attributableOpens).toBeUndefined();
      expect(doc.meaningfulSessionCount).toBeUndefined();
    });
  });

  describe('getRecipientEngagementForProperty', () => {
    it('joins engagement rows with recipient identity for admin display', async () => {
      state.recipients.rec1 = { name: 'Luke Wilson', email: 'luke@example.com', isTest: true };
      state.recipientEngagement['propA_rec1'] = {
        propertyId: 'propA', recipientId: 'rec1', attributableOpens: 3, meaningfulSessionCount: 2,
        scannerSuspectedOpens: 0, firstViewedAt: { toDate: () => new Date('2026-01-01T08:00:00Z') },
        lastViewedAt: { toDate: () => new Date('2026-01-01T08:25:00Z') },
      };
      const { getRecipientEngagementForProperty } = await import('../../src/app/api/services/recipientLinkService');
      const rows = await getRecipientEngagementForProperty('propA');
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ recipientId: 'rec1', name: 'Luke Wilson', email: 'luke@example.com', attributableOpens: 3, meaningfulSessionCount: 2 });
    });
  });
});
