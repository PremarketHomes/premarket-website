import { describe, it, expect } from 'vitest';
import { resolveListingAgent, listingCardAgent } from '../../src/app/utils/listingAgent';
import { getAssignedAgentProfile } from '../../src/app/api/services/publicProfileService';

// Admin A uploaded the listing under their account; Agent B is the assigned agent.
const admin = { firstName: 'Admin', lastName: 'Uploader', avatar: 'https://img/admin.jpg', phone: '0400000001', companyName: 'HPH' };

describe('resolveListingAgent: the ASSIGNED agent is always presented, never the uploader', () => {
  it('shows Agent B (name, photo, phone) when Admin A uploaded for them', () => {
    const r = resolveListingAgent({
      property: { userId: 'adminA', agentId: 'r1', agentName: 'Agent Bee', agentAvatar: 'https://img/bee.jpg' },
      ownerProfile: admin,
      rosterAgent: { name: 'Agent Bee', phone: '0400000002', email: 'bee@x.com' },
    });
    expect(r).toMatchObject({ assigned: true, firstName: 'Agent Bee', avatar: 'https://img/bee.jpg', phone: '0400000002', email: 'bee@x.com' });
    expect(JSON.stringify(r)).not.toMatch(/Admin|admin\.jpg|0400000001/);
  });

  it('assigned agent with NO photo gets the placeholder (null), never the admin photo', () => {
    const r = resolveListingAgent({ property: { userId: 'adminA', agentId: 'r1', agentName: 'Agent Bee', agentAvatar: null }, ownerProfile: admin, rosterAgent: { name: 'Agent Bee' } });
    expect(r.avatar).toBeNull();
    expect(r.phone).toBeNull(); // admin's phone is never a fallback
  });

  it('a roster agent with no login account still resolves from the roster, not the admin', () => {
    const r = resolveListingAgent({ property: { userId: 'adminA', agentId: 'r2', agentName: null }, ownerProfile: admin, rosterAgent: { name: 'No Login', avatar: 'https://img/nl.jpg' } });
    expect(r).toMatchObject({ firstName: 'No Login', avatar: 'https://img/nl.jpg' });
  });

  it('unresolvable assigned agent shows no name rather than the admin name', () => {
    const r = resolveListingAgent({ property: { userId: 'adminA', agentId: 'gone' }, ownerProfile: admin, rosterAgent: null });
    expect(r.firstName).toBe('');
    expect(r.avatar).toBeNull();
  });

  it('prefers the office-directory profile for the assigned agent', () => {
    const r = resolveListingAgent({
      property: { userId: 'adminA', agentId: 'r1', agentName: 'Chantal Damiani', agentAvatar: null },
      ownerProfile: admin, rosterAgent: { name: 'Chantal Damiani' },
      directoryAgent: { firstName: 'Chantal', lastName: 'Damiani', avatar: 'https://img/c.jpg', phone: '0407206763' },
    });
    expect(r).toMatchObject({ firstName: 'Chantal Damiani', avatar: 'https://img/c.jpg', phone: '0407206763' });
  });

  it('a reassigned property follows its CURRENT assignment', () => {
    const base = { userId: 'adminA', agentId: 'r1', agentName: 'First Agent', agentAvatar: 'https://img/1.jpg' };
    expect(resolveListingAgent({ property: base, ownerProfile: admin }).firstName).toBe('First Agent');
    const re = { ...base, agentId: 'r2', agentName: 'Second Agent', agentAvatar: null };
    const r = resolveListingAgent({ property: re, ownerProfile: admin });
    expect(r.firstName).toBe('Second Agent');
    expect(r.avatar).toBeNull();
  });

  it('an agent listing their own property (no assignment) is presented as themselves', () => {
    const r = resolveListingAgent({ property: { userId: 'agentX' }, ownerProfile: { firstName: 'Self', lastName: 'Agent', avatar: 'https://img/s.jpg', phone: '0411' } });
    expect(r).toMatchObject({ assigned: false, firstName: 'Self', lastName: 'Agent', avatar: 'https://img/s.jpg', phone: '0411' });
  });

  it('listing cards (/listings, homepage) use the same rule', () => {
    const c = listingCardAgent({ property: { userId: 'adminA', agentId: 'r1', agentName: 'Agent Bee' }, accountAgent: admin, rosterAgent: { name: 'Agent Bee', avatar: null } });
    expect(c).toEqual({ displayName: 'Agent Bee', displayAvatar: null });
  });
});

// Minimal Firestore fake for getAssignedAgentProfile.
function fakeDb({ property, users, officeAgents = [] }) {
  const snap = (rows) => ({ docs: rows.map(([id, data]) => ({ id, data: () => data })), empty: rows.length === 0 });
  return {
    collection(name) {
      return {
        doc(id) {
          return { get: async () => {
            const row = name === 'properties' ? (id === 'prop1' ? property : null) : users[id];
            return { exists: !!row, id, data: () => row };
          } };
        },
        where(f, _o, v) {
          const chain = { filters: [[f, v]], where(f2, _o2, v2) { this.filters.push([f2, v2]); return this; },
            limit() { return this; },
            async get() {
              const pool = name === 'users' ? Object.entries(users) : name === 'officeAgents' ? officeAgents.map((a, i) => [`oa${i}`, a]) : [];
              return snap(pool.filter(([, d]) => this.filters.every(([k, val]) => d[k] === val)));
            } };
          return chain;
        },
      };
    },
  };
}

describe('getAssignedAgentProfile: Peta uploads for Chantal (production shape)', () => {
  const users = {
    peta: { firstName: 'Peta', lastName: 'Harris', officeId: 'hph', agent: true, avatar: 'https://img/peta.jpg', phone: '0439539399' },
    chantal: { firstName: 'Chantal', lastName: 'Damiani', officeId: 'hph', agent: true, avatar: 'https://img/chantal-old.jpg', phone: '0407206763' },
  };
  const property = { userId: 'peta', agentId: 'roster1', agentName: 'Chantal Damiani', agentAvatar: null };
  const officeAgents = [{ officeId: 'hph', linkedUid: 'chantal', photoUrl: 'https://img/chantal-directory.jpg' }];

  it('resolves Chantal (directory photo + her phone), not Peta', async () => {
    const p = await getAssignedAgentProfile(fakeDb({ property, users, officeAgents }), 'prop1');
    expect(p).toEqual({ firstName: 'Chantal', lastName: 'Damiani', avatar: 'https://img/chantal-directory.jpg', phone: '0407206763' });
  });

  it('works for an agent who has never logged in (invited account, directory profile)', async () => {
    const u = { ...users, chantal: { ...users.chantal, accountStatus: 'invited', avatar: undefined } };
    const p = await getAssignedAgentProfile(fakeDb({ property, users: u, officeAgents }), 'prop1');
    expect(p.firstName).toBe('Chantal');
    expect(p.avatar).toBe('https://img/chantal-directory.jpg');
  });

  it('ambiguous name (two matching agents) resolves to null — never guesses', async () => {
    const u = { ...users, chantal2: { ...users.chantal } };
    expect(await getAssignedAgentProfile(fakeDb({ property, users: u, officeAgents }), 'prop1')).toBeNull();
  });

  it('no match resolves to null; unassigned property resolves to null', async () => {
    expect(await getAssignedAgentProfile(fakeDb({ property: { ...property, agentName: 'Someone Else' }, users, officeAgents }), 'prop1')).toBeNull();
    expect(await getAssignedAgentProfile(fakeDb({ property: { userId: 'peta' }, users, officeAgents }), 'prop1')).toBeNull();
  });

  it('end to end: the page data for this listing is Chantal and contains nothing of Peta', async () => {
    const directoryAgent = await getAssignedAgentProfile(fakeDb({ property, users, officeAgents }), 'prop1');
    const r = resolveListingAgent({ property, ownerProfile: users.peta, rosterAgent: { name: 'Chantal Damiani' }, directoryAgent });
    expect(r.firstName).toBe('Chantal Damiani');
    expect(JSON.stringify(r)).not.toMatch(/Peta|peta\.jpg|0439539399/);
  });
});
