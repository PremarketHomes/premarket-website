import { describe, it, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { deleteField, serverTimestamp, Timestamp, query, where } from 'firebase/firestore';
import {
  getTestEnv, getAuthedDb, getUnauthDb, getSuperAdminDb, seedDoc,
  cleanup, teardown,
  assertSucceeds, assertFails,
  doc, getDoc, setDoc, updateDoc, deleteDoc, collection, addDoc, getDocs,
} from './helpers.js';

// The kiosk payload builders are pure; only the client Firebase app needs stubbing.
vi.mock('../../src/app/firebase/clientApp', () => ({ db: {} }));
const { buildOpinionItem, buildRegistrationItem } = await import('../../src/app/utils/kioskPersistence.js');

beforeAll(async () => { await getTestEnv(); });
afterAll(async () => { await teardown(); });
beforeEach(async () => {
  await cleanup();
  await seedDoc('properties/prop1', { userId: 'agent1' });
});

// ── Payloads exactly as the app writes them ─────────────────────────────────

// PropertyPageClient.js handleSubmit (price opinion).
const webOpinion = (overrides = {}) => ({
  type: 'opinion',
  propertyId: 'prop1',
  sessionId: 'session_1731300000000_abc123def',
  visitorId: 'v_visitor1',
  offerAmount: 1250000,
  updatedAt: serverTimestamp(),
  fromWeb: true,
  ...overrides,
});

// PropertyPageClient.js handleContactSubmit (register interest).
const interestFields = ({ link } = {}) => ({
  serious: true,
  isFirstHomeBuyer: false,
  isInvestor: true,
  buyerType: 'investor',
  nextAction: 'contact',
  timeframe: '3-6 months',
  buyerName: 'Jamie Buyer',
  buyerEmail: 'jamie@example.com',
  buyerPhone: '0400 111 222',
  ...(link ? { userId: link } : {}),
  updatedAt: serverTimestamp(),
});

// A registration as its OWN record (utils/opinionRecords.registrationRecord): no price, session or device id.
const separateRegistration = ({ link } = {}) => {
  const { updatedAt, ...fields } = interestFields({ link });
  return { type: 'opinion', propertyId: 'prop1', fromWeb: true, ...fields };
};

// Kiosk writeKioskItem: createdAtIso becomes a stable client Timestamp.
const kioskWrite = (db, item) => {
  const { createdAtIso, ...fields } = item.data;
  return setDoc(
    doc(db, 'offers', item.docId),
    { ...fields, createdAt: Timestamp.fromDate(new Date(createdAtIso)), updatedAt: serverTimestamp() },
    { merge: true },
  );
};
const kioskOpinion = { id: 'kioskOffer1', amount: 980000, at: Date.parse('2026-11-08T01:00:00Z') };
const kioskBuyer = { firstName: 'Sam', lastName: 'Visitor', email: 'Sam@Example.com', phone: '0400 333 444' };

// An existing registration typed in by an anonymous visitor (not linked to any account).
const seedRegistration = (id = 'reg1', extra = {}) => seedDoc(`offers/${id}`, {
  type: 'opinion', propertyId: 'prop1', sessionId: 'session_1_victim', visitorId: 'v_victim',
  offerAmount: 1100000, fromWeb: true, createdAt: Timestamp.fromDate(new Date('2026-11-01T00:00:00Z')),
  serious: true, isFirstHomeBuyer: true, isInvestor: false, buyerType: 'owner-occupier',
  nextAction: 'contact', timeframe: 'ASAP',
  buyerName: 'Victim Buyer', buyerEmail: 'victim@example.com', buyerPhone: '0400 999 888',
  interestNotifiedAt: Timestamp.fromDate(new Date('2026-11-01T00:01:00Z')),
  ...extra,
});

// A bare anonymous opinion (no contact details yet).
const seedOpinion = (id = 'op1', extra = {}) => seedDoc(`offers/${id}`, {
  type: 'opinion', propertyId: 'prop1', sessionId: 'session_1_visitor', visitorId: 'v_visitor1',
  offerAmount: 900000, fromWeb: true, createdAt: Timestamp.fromDate(new Date('2026-11-10T00:00:00Z')),
  ...extra,
});

describe('offers: reads (buyer personal details)', () => {
  it('denies an unauthenticated read', async () => {
    await seedRegistration();
    await assertFails(getDoc(doc(getUnauthDb(), 'offers', 'reg1')));
  });

  it('denies an unrelated signed-in user', async () => {
    await seedRegistration('reg1', { userId: 'buyer1' });
    await assertFails(getDoc(doc(getAuthedDb('stranger'), 'offers', 'reg1')));
  });

  it('allows the linked buyer to read their own offer', async () => {
    await seedRegistration('reg1', { userId: 'buyer1' });
    await assertSucceeds(getDoc(doc(getAuthedDb('buyer1'), 'offers', 'reg1')));
  });

  it("PRIVACY: the listing's agent cannot read raw offers (their report comes from the server, separated)", async () => {
    await seedRegistration(); // an older record: the buyer's details next to their price
    await assertFails(getDoc(doc(getAuthedDb('agent1'), 'offers', 'reg1')));
    await seedOpinion();
    await assertFails(getDoc(doc(getAuthedDb('agent1'), 'offers', 'op1')));
  });

  it('denies the agent of a different listing', async () => {
    await seedRegistration();
    await assertFails(getDoc(doc(getAuthedDb('agent2'), 'offers', 'reg1')));
  });

  it('allows a superAdmin', async () => {
    await seedRegistration();
    const db = await getSuperAdminDb();
    await assertSucceeds(getDoc(doc(db, 'offers', 'reg1')));
  });

  it('denies everyone but superAdmin when the listing was deleted', async () => {
    await seedRegistration('orphan1', { propertyId: 'deletedListing' });
    await assertFails(getDoc(doc(getAuthedDb('agent1'), 'offers', 'orphan1')));
  });

  it('denies listing the whole collection, signed out or signed in', async () => {
    await seedRegistration();
    await assertFails(getDocs(collection(getUnauthDb(), 'offers')));
    await assertFails(getDocs(collection(getAuthedDb('stranger'), 'offers')));
  });

  it("denies a stranger querying another listing's offers", async () => {
    await seedRegistration();
    await assertFails(getDocs(query(collection(getAuthedDb('stranger'), 'offers'), where('propertyId', '==', 'prop1'))));
  });

  it("PRIVACY: the agent's own listing query is refused (the dashboard gets counts from /api/offers/opinion-counts)", async () => {
    await seedRegistration();
    await assertFails(getDocs(query(collection(getAuthedDb('agent1'), 'offers'), where('propertyId', '==', 'prop1'))));
  });

  it("supports the buyer dashboard query (userId == own uid)", async () => {
    await seedRegistration('reg1', { userId: 'buyer1' });
    await assertSucceeds(getDocs(query(collection(getAuthedDb('buyer1'), 'offers'), where('userId', '==', 'buyer1'))));
  });

  it('supports the superAdmin CRM query by buyer email', async () => {
    await seedRegistration();
    const db = await getSuperAdminDb();
    await assertSucceeds(getDocs(query(collection(db, 'offers'), where('buyerEmail', '==', 'victim@example.com'))));
  });
});

describe('offers: legitimate property-page flows', () => {
  it('signed-out visitor saves a price opinion (create)', async () => {
    await assertSucceeds(addDoc(collection(getUnauthDb(), 'offers'), { ...webOpinion(), createdAt: serverTimestamp() }));
  });

  it('signed-in visitor saves a price opinion (create, no userId)', async () => {
    await assertSucceeds(addDoc(collection(getAuthedDb('buyer1'), 'offers'), { ...webOpinion(), createdAt: serverTimestamp() }));
  });

  it('signed-out visitor re-saves their opinion (update: amount only)', async () => {
    await seedOpinion();
    await assertSucceeds(updateDoc(doc(getUnauthDb(), 'offers', 'op1'),
      { offerAmount: 950000, updatedAt: serverTimestamp(), fromWeb: true }));
  });

  it('signed-out visitor registers interest after their opinion: a NEW, separate registration record', async () => {
    await seedOpinion();
    await assertSucceeds(addDoc(collection(getUnauthDb(), 'offers'), { ...separateRegistration(), createdAt: serverTimestamp() }));
  });

  it('signed-out visitor registers interest with no prior opinion (same separate record)', async () => {
    await assertSucceeds(addDoc(collection(getUnauthDb(), 'offers'), { ...separateRegistration(), createdAt: serverTimestamp() }));
  });

  it('signed-in buyer registers with their own email: the registration carries their account, never the opinion', async () => {
    await assertSucceeds(addDoc(collection(getAuthedDb('buyer1'), 'offers'),
      { ...separateRegistration({ link: 'buyer1' }), createdAt: serverTimestamp() }));
  });

  it("signed-in agent registers someone else's details (separate record, no account link)", async () => {
    await assertSucceeds(addDoc(collection(getAuthedDb('agent1'), 'offers'), { ...separateRegistration(), createdAt: serverTimestamp() }));
  });

  it('a second submit from the same tab updates the registration (same details, new answers; unlinking allowed)', async () => {
    await seedDoc('offers/r1', { ...separateRegistration({ link: 'buyer1' }), updatedAt: null });
    const { type, propertyId, fromWeb, ...answers } = separateRegistration({ link: 'buyer1' });
    await assertSucceeds(updateDoc(doc(getAuthedDb('buyer1'), 'offers', 'r1'), { ...answers, timeframe: '1_3_months' }));
    await assertSucceeds(updateDoc(doc(getAuthedDb('buyer1'), 'offers', 'r1'), { userId: deleteField() }));
  });

  it('visitor submits the same registration twice (identical details)', async () => {
    await seedDoc('offers/r2', { ...separateRegistration(), updatedAt: null });
    const { type, propertyId, fromWeb, ...answers } = separateRegistration();
    const db = getUnauthDb();
    await assertSucceeds(updateDoc(doc(db, 'offers', 'r2'), answers));
    await assertSucceeds(updateDoc(doc(db, 'offers', 'r2'), answers));
  });
});

describe('offers: a buyer is never stored with a price (opinion / registration split)', () => {
  it('PRIVACY: contact details or an account can never be added onto a price opinion', async () => {
    await seedOpinion();
    await assertFails(updateDoc(doc(getUnauthDb(), 'offers', 'op1'), interestFields()));
    await assertFails(updateDoc(doc(getAuthedDb('buyer1'), 'offers', 'op1'), { userId: 'buyer1' }));
    await assertFails(updateDoc(doc(getUnauthDb(), 'offers', 'op1'), { serious: true, buyerType: 'investor' }));
  });

  it('PRIVACY: an opinion cannot be created with buyer details, an account or the serious flag', async () => {
    await assertFails(addDoc(collection(getUnauthDb(), 'offers'), { ...webOpinion(), ...interestFields() }));
    await assertFails(addDoc(collection(getAuthedDb('buyer1'), 'offers'), { ...webOpinion(), userId: 'buyer1' }));
    await assertFails(addDoc(collection(getUnauthDb(), 'offers'), { ...webOpinion(), serious: true }));
  });

  it('PRIVACY: a record with buyer details must be a (serious) registration', async () => {
    await assertFails(addDoc(collection(getUnauthDb(), 'offers'), { ...separateRegistration(), serious: false }));
  });

  it('PRIVACY: a registration can never hold a price, the session id or the device id', async () => {
    for (const extra of [{ offerAmount: 1000000 }, { sessionId: 'session_1_visitor' }, { visitorId: 'v_visitor1' }]) {
      await assertFails(addDoc(collection(getUnauthDb(), 'offers'), { ...separateRegistration(), ...extra }));
    }
    await seedDoc('offers/r3', separateRegistration());
    await assertFails(updateDoc(doc(getUnauthDb(), 'offers', 'r3'), { offerAmount: 1000000 }));
    await assertFails(updateDoc(doc(getUnauthDb(), 'offers', 'r3'), { visitorId: 'v_visitor1' }));
  });

  it('PRIVACY: a registration cannot be turned into an opinion, nor an opinion into a registration', async () => {
    await seedDoc('offers/r4', separateRegistration());
    await assertFails(updateDoc(doc(getUnauthDb(), 'offers', 'r4'), { serious: false, offerAmount: 1000000 }));
    await seedOpinion();
    await assertFails(updateDoc(doc(getUnauthDb(), 'offers', 'op1'), { serious: true }));
  });

  it('PRIVACY: the old app\'s combined registration (with session and device ids) is refused', async () => {
    await assertFails(addDoc(collection(getUnauthDb(), 'offers'), {
      type: 'opinion', propertyId: 'prop1', sessionId: 'session_2', visitorId: 'v2', fromWeb: true, ...interestFields(),
    }));
  });

  it('older combined records are left as they are: no client can edit one any more (not even the linked buyer)', async () => {
    await seedRegistration('reg1', { userId: 'buyer1' });
    await assertFails(updateDoc(doc(getAuthedDb('buyer1'), 'offers', 'reg1'), { offerAmount: 1150000 }));
    await assertFails(updateDoc(doc(getUnauthDb(), 'offers', 'reg1'), { offerAmount: 1150000 }));
  });
});

describe('offers: legitimate iPad kiosk flows (real payload builders)', () => {
  const opinionItem = () => buildOpinionItem({ propertyId: 'prop1', opinion: kioskOpinion, sessionId: 'ipad_1731000000000_abcdefg' });
  const registrationItem = (docId = 'kioskReg1') => buildRegistrationItem({
    propertyId: 'prop1', docId, createdAtIso: new Date(kioskOpinion.at).toISOString(), buyer: kioskBuyer,
  });

  for (const [label, db] of [['signed out', () => getUnauthDb()], ['signed in as the listing agent', () => getAuthedDb('agent1')]]) {
    it(`${label}: opinion, retried opinion, registration on its OWN id, retried registration`, async () => {
      await assertSucceeds(kioskWrite(db(), opinionItem()));
      await assertSucceeds(kioskWrite(db(), opinionItem()));
      await assertSucceeds(kioskWrite(db(), registrationItem()));
      await assertSucceeds(kioskWrite(db(), registrationItem()));
      await assertSucceeds(kioskWrite(db(), opinionItem())); // a late retry of the opinion: separate record, no effect
    });

    it(`${label}: registration with no opinion`, async () => {
      await assertSucceeds(kioskWrite(db(), registrationItem('kioskReg2')));
    });

    it(`PRIVACY ${label}: a registration written onto the opinion's id is refused`, async () => {
      await assertSucceeds(kioskWrite(db(), opinionItem()));
      await assertFails(kioskWrite(db(), registrationItem(kioskOpinion.id)));
    });
  }
});

describe('offers: legitimate TV display flow', () => {
  it('anonymous opinion, then a new account creates its OWN registration (answers included, no price)', async () => {
    await assertSucceeds(addDoc(collection(getUnauthDb(), 'offers'), {
      type: 'opinion', propertyId: 'prop1', sessionId: 'tv_1731000000000_abcdefg', offerAmount: 1000000,
      createdAt: serverTimestamp(), updatedAt: serverTimestamp(), fromWeb: true, fromTvDisplay: true, displayId: 'display1',
    }));
    await assertSucceeds(addDoc(collection(getAuthedDb('newTvBuyer'), 'offers'), {
      ...separateRegistration({ link: 'newTvBuyer' }), buyerPhone: null, seriousnessLevel: 'ready_to_buy',
      fromTvDisplay: true, displayId: 'display1', createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
    }));
  });
});

describe('offers: takeover and account-association attacks', () => {
  it("SECURITY: a signed-in user cannot claim an anonymous buyer's registration (userId = self)", async () => {
    await seedRegistration();
    const db = getAuthedDb('attacker');
    await assertFails(updateDoc(doc(db, 'offers', 'reg1'), { userId: 'attacker' }));
    await assertFails(getDoc(doc(db, 'offers', 'reg1')));
  });

  it('SECURITY: claiming fails even when the attacker also rewrites the contact details', async () => {
    await seedRegistration();
    await assertFails(updateDoc(doc(getAuthedDb('attacker'), 'offers', 'reg1'), interestFields({ link: 'attacker' })));
  });

  it('SECURITY: a registration with only a phone or only a name still cannot be claimed', async () => {
    await seedRegistration('reg1', { buyerEmail: null, buyerName: '' });
    await assertFails(updateDoc(doc(getAuthedDb('attacker'), 'offers', 'reg1'), { userId: 'attacker' }));
    await seedRegistration('reg2', { buyerEmail: '', buyerPhone: null });
    await assertFails(updateDoc(doc(getAuthedDb('attacker'), 'offers', 'reg2'), { userId: 'attacker' }));
  });

  it('SECURITY: an older document with other (legacy) fields cannot be claimed', async () => {
    await seedDoc('offers/legacy1', { type: 'opinion', propertyId: 'prop1', email: 'old@example.com', phone: '0400', userName: 'Old Buyer' });
    await assertFails(updateDoc(doc(getAuthedDb('attacker'), 'offers', 'legacy1'), { userId: 'attacker' }));
  });

  it("SECURITY: a signed-in user cannot claim an offer already linked to someone else", async () => {
    await seedRegistration('reg1', { userId: 'buyer1' });
    await assertFails(updateDoc(doc(getAuthedDb('attacker'), 'offers', 'reg1'), { userId: 'attacker' }));
  });

  it("SECURITY: nobody can attach someone else's account to an offer (planting a userId)", async () => {
    await seedOpinion();
    await assertFails(updateDoc(doc(getAuthedDb('agent1'), 'offers', 'op1'), { userId: 'victimUid' }));
    await assertFails(updateDoc(doc(getUnauthDb(), 'offers', 'op1'), { userId: 'victimUid' }));
  });

  it("SECURITY: nobody can create an offer carrying someone else's userId", async () => {
    // e.g. an agent planting a buyer's uid (uids are public on `likes`) on their own
    // listing, to pull that buyer's profile through /api/properties/[id]/buyer-profiles.
    await assertFails(addDoc(collection(getAuthedDb('agent1'), 'offers'), { ...webOpinion(), serious: true, userId: 'victimUid' }));
    await assertFails(addDoc(collection(getUnauthDb(), 'offers'), { ...webOpinion(), userId: 'victimUid' }));
    await assertFails(addDoc(collection(getAuthedDb('agent1'), 'offers'), { ...webOpinion(), userId: null }));
  });

  it('SECURITY: a signed-out visitor cannot link any offer', async () => {
    await seedOpinion();
    await assertFails(updateDoc(doc(getUnauthDb(), 'offers', 'op1'), { userId: 'someone' }));
  });

  it("SECURITY: only the linked buyer can unlink their offer", async () => {
    await seedRegistration('reg1', { userId: 'buyer1' });
    await assertFails(updateDoc(doc(getAuthedDb('attacker'), 'offers', 'reg1'), { userId: deleteField() }));
    await assertFails(updateDoc(doc(getUnauthDb(), 'offers', 'reg1'), { userId: deleteField() }));
  });

  it('SECURITY: the linked buyer cannot hand their offer to another account', async () => {
    await seedRegistration('reg1', { userId: 'buyer1' });
    await assertFails(updateDoc(doc(getAuthedDb('buyer1'), 'offers', 'reg1'), { userId: 'buyer2' }));
  });
});

describe('offers: overwrite attacks', () => {
  it("SECURITY: nobody but the linked buyer can change a linked offer at all", async () => {
    await seedRegistration('reg1', { userId: 'buyer1' });
    await assertFails(updateDoc(doc(getUnauthDb(), 'offers', 'reg1'), { offerAmount: 1 }));
    await assertFails(updateDoc(doc(getAuthedDb('attacker'), 'offers', 'reg1'), { offerAmount: 1 }));
    await assertFails(updateDoc(doc(getAuthedDb('agent1'), 'offers', 'reg1'), { offerAmount: 1 }));
  });

  for (const field of ['buyerName', 'buyerEmail', 'buyerPhone']) {
    it(`SECURITY: ${field} on an unlinked registration cannot be replaced, blanked or removed`, async () => {
      await seedRegistration();
      const db = getUnauthDb();
      await assertFails(updateDoc(doc(db, 'offers', 'reg1'), { [field]: 'attacker value' }));
      await assertFails(updateDoc(doc(db, 'offers', 'reg1'), { [field]: '' }));
      await assertFails(updateDoc(doc(db, 'offers', 'reg1'), { [field]: null }));
      await assertFails(updateDoc(doc(db, 'offers', 'reg1'), { [field]: deleteField() }));
      await assertFails(updateDoc(doc(getAuthedDb('attacker'), 'offers', 'reg1'), { [field]: 'attacker value' }));
    });
  }

  it('SECURITY: a registration cannot be downgraded (serious true -> false or removed)', async () => {
    await seedRegistration();
    await assertFails(updateDoc(doc(getUnauthDb(), 'offers', 'reg1'), { serious: false }));
    await assertFails(updateDoc(doc(getUnauthDb(), 'offers', 'reg1'), { serious: deleteField() }));
  });

  it('SECURITY: the interest-notification bookkeeping is server-only', async () => {
    await seedRegistration();
    const db = getUnauthDb();
    await assertFails(updateDoc(doc(db, 'offers', 'reg1'), { interestNotifiedAt: deleteField() }));
    await assertFails(updateDoc(doc(db, 'offers', 'reg1'), { interestNotifyingSince: serverTimestamp() }));
    await assertFails(addDoc(collection(db, 'offers'), { ...webOpinion(), interestNotifiedAt: serverTimestamp() }));
  });

  for (const [field, value] of [['propertyId', 'prop2'], ['type', 'offer'], ['sessionId', 'session_attacker'],
    ['createdAt', Timestamp.fromDate(new Date('2020-01-01'))], ['fromIpadMode', true], ['displayId', 'x']]) {
    it(`SECURITY: ${field} cannot be changed after creation`, async () => {
      await seedRegistration();
      await assertFails(updateDoc(doc(getUnauthDb(), 'offers', 'reg1'), { [field]: value }));
    });
  }

  it('SECURITY: unknown fields cannot be added on update or create', async () => {
    await seedRegistration();
    await assertFails(updateDoc(doc(getUnauthDb(), 'offers', 'reg1'), { propertyAddress: 'Click here: http://phish' }));
    await assertFails(addDoc(collection(getUnauthDb(), 'offers'), { ...webOpinion(), propertyAddress: 'x' }));
    await assertFails(addDoc(collection(getUnauthDb(), 'offers'), { ...webOpinion(), superAdmin: true }));
  });

  it('SECURITY: create needs type "opinion" and a string propertyId', async () => {
    const db = getUnauthDb();
    await assertFails(addDoc(collection(db, 'offers'), webOpinion({ type: 'offer' })));
    const { type, ...noType } = webOpinion();
    await assertFails(addDoc(collection(db, 'offers'), noType));
    const { propertyId, ...noProperty } = webOpinion();
    await assertFails(addDoc(collection(db, 'offers'), noProperty));
    await assertFails(addDoc(collection(db, 'offers'), webOpinion({ propertyId: 123 })));
  });

  it('SECURITY: create over an existing id is an update and follows the update rules', async () => {
    await seedRegistration();
    await assertFails(setDoc(doc(getUnauthDb(), 'offers', 'reg1'), { ...webOpinion(), buyerEmail: 'attacker@example.com' }));
  });

  it('nobody can delete an offer', async () => {
    await seedRegistration('reg1', { userId: 'buyer1' });
    await assertFails(deleteDoc(doc(getUnauthDb(), 'offers', 'reg1')));
    await assertFails(deleteDoc(doc(getAuthedDb('buyer1'), 'offers', 'reg1')));
    await assertFails(deleteDoc(doc(getAuthedDb('agent1'), 'offers', 'reg1')));
  });
});

describe('orphaned offers on deleted listings', () => {
  it('SECURITY: a deleted listing id that still has offers cannot be re-created to read them', async () => {
    await seedRegistration('orphan1', { propertyId: '11YU7ChRxRELB0LFa8lb' });
    const db = getAuthedDb('attacker');
    await assertFails(setDoc(doc(db, 'properties', '11YU7ChRxRELB0LFa8lb'), { userId: 'attacker', title: 'x' }));
    await assertFails(getDoc(doc(db, 'offers', 'orphan1')));
  });

  it('every retired id is blocked', async () => {
    const ids = ['11YU7ChRxRELB0LFa8lb', '1XEC5cLbb3n86jf6phQ7', 'LIMMpRAu5V2rAL8X7NEf', 'Sz0R6YU0FUIM8kt4vJUK',
      'pzd3dzZexvGuPCYCyk2o', 'EWkE1WK74ANPCfbCzSBP', 'RKHYSLNSJUJS4Mb8Whnu', '3cysx7Borvdn0SLp2azN',
      'JLRR70gkWEPjpST4avsI', 'SjYhfaqYv6rkVxC4lFFL', 'C85BhLy6RT0qt7NiE8Ck'];
    for (const id of ids) {
      await assertFails(setDoc(doc(getAuthedDb('attacker'), 'properties', id), { userId: 'attacker' }));
    }
  });

  it('agents still create listings normally (random ids)', async () => {
    await assertSucceeds(addDoc(collection(getAuthedDb('agent1'), 'properties'), { userId: 'agent1', title: 'New listing' }));
  });
});
