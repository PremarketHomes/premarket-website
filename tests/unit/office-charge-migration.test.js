import { describe, it, expect, beforeEach } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { planOfficeChargeMigration, applyOfficeChargeMigration } = require('../../scripts/lib/officeChargeMigration');

function makeFakeDb() {
  const store = {};
  const table = (n) => (store[n] = store[n] || {});
  const snap = (n, id) => ({ exists: !!table(n)[id], id, data: () => table(n)[id], ref: { _col: n, id } });
  const query = (n, filters) => ({
    where: (f, o, v) => query(n, [...filters, [f, v]]),
    async get() {
      const docs = Object.keys(table(n)).map((id) => snap(n, id)).filter((d) => filters.every(([f, v]) => d.data()[f] === v));
      return { docs, empty: !docs.length };
    },
  });
  return {
    _store: store,
    seed: (n, id, d) => { table(n)[id] = d; },
    collection: (n) => ({ doc: (id) => ({ _col: n, id, get: async () => snap(n, id) }), ...query(n, []) }),
    async runTransaction(fn) {
      const writes = [];
      const out = await fn({
        get: async (ref) => snap(ref._col, ref.id),
        update: (ref, patch) => writes.push(() => { table(ref._col)[ref.id] = { ...table(ref._col)[ref.id], ...patch }; }),
      });
      writes.forEach((w) => w());
      return out;
    },
  };
}

const FieldValue = { serverTimestamp: () => 'TS' };
const agentCharge = (over = {}) => ({
  propertyId: 'x', propertyAddress: '1 St', agentUserId: 'phil', agentName: 'Phil Agent',
  billingEntityType: 'independent', billingEntityKey: 'agent:phil', billingEntityName: 'Phil Agent',
  status: 'pending', runId: null, totalInc: 200, createdAt: new Date('2026-10-20'), ...over,
});

let db;
beforeEach(() => {
  db = makeFakeDb();
  db.seed('officeAdminInfo', 'hph', { name: 'Harcourts Property Hub', status: 'active' });
  db.seed('users', 'phil', { firstName: 'Phil', officeId: 'hph', invitedAt: new Date('2026-10-18') });
  db.seed('users', 'solo', { firstName: 'Sol' });
});

describe('planOfficeChargeMigration (read-only)', () => {
  it('lists only pending, unattached, agent-keyed charges of agents currently in an active office — and changes nothing', async () => {
    db.seed('propertyCharges', 'phil1', agentCharge());
    db.seed('propertyCharges', 'solo1', agentCharge({ agentUserId: 'solo', billingEntityKey: 'agent:solo', agentName: 'Sol' }));
    db.seed('propertyCharges', 'philQueued', agentCharge({ status: 'queued', runId: 'run1' }));
    db.seed('propertyCharges', 'philInvoiced', agentCharge({ status: 'invoiced' }));
    db.seed('propertyCharges', 'philAttached', agentCharge({ runId: 'run1' }));
    const before = JSON.stringify(db._store);

    const plan = await planOfficeChargeMigration(db);

    expect(plan.candidates.map((c) => c.chargeId)).toEqual(['phil1']);
    expect(plan.candidates[0]).toMatchObject({ fromKey: 'agent:phil', toKey: 'office:hph', officeName: 'Harcourts Property Hub', amountInc: 200 });
    expect(plan.candidates[0].agentInvitedAt).toBe('2026-10-18T00:00:00.000Z'); // lets the admin spot pre-join campaigns
    expect(plan.skipped.map((s) => [s.chargeId, s.reason]).sort()).toEqual([
      ['philAttached', 'attached-to-a-run'],
      ['solo1', 'agent-not-in-an-active-office'],
    ]);
    expect(JSON.stringify(db._store)).toBe(before);
  });
});

describe('applyOfficeChargeMigration', () => {
  it('moves only the listed charges, preserving the original key for audit', async () => {
    db.seed('propertyCharges', 'phil1', agentCharge());
    db.seed('propertyCharges', 'phil2', agentCharge());
    const res = await applyOfficeChargeMigration(db, { chargeIds: ['phil1'], adminUid: 'luke', FieldValue, reason: 'HPH rollout' });

    expect(res).toEqual([{ chargeId: 'phil1', moved: true, fromKey: 'agent:phil', toKey: 'office:hph' }]);
    expect(db._store.propertyCharges.phil1).toMatchObject({
      billingEntityType: 'office', billingEntityKey: 'office:hph', billingEntityName: 'Harcourts Property Hub',
      officeId: 'hph', officeName: 'Harcourts Property Hub', agentUserId: 'phil', totalInc: 200, status: 'pending',
      migration: { fromKey: 'agent:phil', fromType: 'independent', fromName: 'Phil Agent', toKey: 'office:hph', by: 'luke', at: 'TS', reason: 'HPH rollout' },
    });
    expect(db._store.propertyCharges.phil2.billingEntityKey).toBe('agent:phil'); // not listed, untouched
  });

  it('NEVER reassigns queued, invoiced, excluded, reversed or run-attached charges', async () => {
    for (const [id, over] of Object.entries({
      q: { status: 'queued', runId: 'r1' }, i: { status: 'invoiced' }, e: { status: 'excluded' },
      v: { status: 'reversed' }, a: { runId: 'r1' },
    })) db.seed('propertyCharges', id, agentCharge(over));
    const before = JSON.stringify(db._store.propertyCharges);

    const res = await applyOfficeChargeMigration(db, { chargeIds: ['q', 'i', 'e', 'v', 'a'], adminUid: 'luke', FieldValue });

    expect(res.every((r) => r.moved === false)).toBe(true);
    expect(JSON.stringify(db._store.propertyCharges)).toBe(before);
  });

  it('is idempotent: re-running on an already-moved charge changes nothing', async () => {
    db.seed('propertyCharges', 'phil1', agentCharge());
    await applyOfficeChargeMigration(db, { chargeIds: ['phil1'], adminUid: 'luke', FieldValue });
    const after1 = JSON.stringify(db._store.propertyCharges);
    const res = await applyOfficeChargeMigration(db, { chargeIds: ['phil1'], adminUid: 'luke', FieldValue });
    expect(res[0]).toMatchObject({ moved: false, reason: 'already-office-keyed' });
    expect(JSON.stringify(db._store.propertyCharges)).toBe(after1);
  });

  it('refuses if the agent is no longer in an active office at apply time', async () => {
    db.seed('propertyCharges', 'solo1', agentCharge({ agentUserId: 'solo', billingEntityKey: 'agent:solo' }));
    const res = await applyOfficeChargeMigration(db, { chargeIds: ['solo1'], adminUid: 'luke', FieldValue });
    expect(res[0]).toMatchObject({ moved: false, reason: 'agent-not-in-an-active-office' });
    expect(db._store.propertyCharges.solo1.billingEntityKey).toBe('agent:solo');
  });

  it('requires an explicit reviewed list and an admin uid — there is no "migrate everything" mode', async () => {
    await expect(applyOfficeChargeMigration(db, { chargeIds: [], adminUid: 'luke', FieldValue })).rejects.toThrow(/chargeIds/);
    await expect(applyOfficeChargeMigration(db, { adminUid: 'luke', FieldValue })).rejects.toThrow(/chargeIds/);
    await expect(applyOfficeChargeMigration(db, { chargeIds: ['x'], FieldValue })).rejects.toThrow(/adminUid/);
  });
});
