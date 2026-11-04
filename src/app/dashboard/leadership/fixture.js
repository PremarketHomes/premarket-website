import { buildLeadershipData, buildAgentProfile } from '../../api/services/leadershipMetrics';

// Sample data for the preview-only routes. Entirely invented: fictional people, addresses and numbers.
// It is fed through the SAME calculation code the live Hub uses, never reads Firestore, and is never
// served in production (see preview/page.js).
const DAY = 86400000;

// uid, name, campaigns, opinions-per-campaign pattern, activated, sign-in days ago
const PEOPLE = [
  ['a1', 'Sample Agent One', 9, [9, 7, 6, 4, 3, 2, 1, 0, 0], true, 1],
  ['a2', 'Sample Agent Two', 8, [8, 6, 5, 3, 2, 2, 1, 0], true, 2],
  ['a3', 'Sample Agent Three', 6, [10, 5, 3, 1, 0, 0], true, 0],
  ['a4', 'Sample Agent Four', 5, [4, 3, 2, 0, 0], true, 3],
  ['a5', 'Sample Agent Five', 4, [3, 1, 1, 0], true, 8],
  ['a6', 'Sample Agent Six', 2, [2, 0], true, 20],
  ['a7', 'Sample Agent Seven', 0, [], true, 4],
  ['a8', 'Sample Agent Eight', 0, [], false, null],
];
const STATUSES = ['live', 'live', 'live', 'hidden', 'sold', 'archived'];
const SUBURBS = ['Sampletown', 'Exampleville', 'Demo Heights'];

function raw(now) {
  const at = (d) => new Date(now.getTime() - d * DAY);
  const members = PEOPLE.map(([uid, name, , , activated]) => {
    const [firstName, ...rest] = name.split(' ');
    return { uid, firstName, lastName: rest.join(' '), avatar: null, accountStatus: activated ? 'active' : 'invited', activatedAt: activated ? at(80) : null, invitedAt: at(90) };
  });
  const properties = [];
  const opinions = [];
  let n = 0;
  PEOPLE.forEach(([uid, , campaigns, pattern], ai) => {
    for (let i = 0; i < campaigns; i++) {
      n += 1;
      const status = i === 0 ? 'live' : STATUSES[(i + ai) % STATUSES.length];
      const ageDays = 3 + i * 14 + ai * 2;
      const id = `demo-${n}`;
      properties.push({
        id, userId: uid, formattedAddress: `${10 + n} Example Street, ${SUBURBS[n % 3]} NSW`,
        createdAt: at(ageDays), price: 650000 + n * 32000, listingStatus: n % 3 ? 'pre-market' : 'on-market',
        visibility: status === 'live', archived: status === 'sold' || status === 'archived', archivedReason: status === 'sold' ? 'sold' : undefined,
        stats: { views: pattern[i] === 0 && i > 5 ? 4 : 18 + pattern[i] * 11 + ((n * 7) % 23) },
      });
      for (let k = 0; k < pattern[i]; k++) {
        opinions.push({ id: `${id}-o${k}`, propertyId: id, type: 'opinion', serious: k % 4 === 0, createdAt: at(Math.min(ageDays - 1, (k * 5 + ai + i) % 75)) });
      }
    }
  });
  return { members, pendingInvites: [{ targetUid: 'inv', targetName: 'Sample Invitee', createdAt: at(5) }], properties, opinions, lastSignIns: Object.fromEntries(PEOPLE.map(([uid, , , , , d]) => [uid, d == null ? null : at(d).toISOString()])), now };
}

const person = (firstName) => ({ firstName, lastName: '', avatar: null });

export function sampleHub(firstName) {
  const now = new Date();
  return { sample: true, office: { name: 'Sample Agency' }, leader: person(firstName), ...buildLeadershipData(raw(now)) };
}

export function sampleProfile(firstName, uid) {
  const now = new Date();
  const profile = buildAgentProfile(raw(now), uid);
  return profile ? { sample: true, office: { name: 'Sample Agency' }, leader: person(firstName), ...profile } : null;
}
