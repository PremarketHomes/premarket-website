import * as Sentry from '@sentry/nextjs';
import { isExcludedOpinion } from '../../utils/opinionExclusion';
import { isRegistrationOnly } from '../../utils/opinionRecords';

/**
 * Contact Computation Engine
 *
 * Aggregates data from offers, properties, users, and likes collections
 * into a unified `contacts` collection with buyer/seller scores.
 */

// ─── Normalization ───────────────────────────────────────────────────────────

export function normalizeEmail(email) {
  if (!email) return null;
  return String(email).toLowerCase().trim();
}

export function normalizePhone(phone) {
  if (!phone) return null;
  let cleaned = String(phone).replace(/[\s\-\(\)\.]/g, '');
  // Normalize +61 → 0 prefix
  if (cleaned.startsWith('+61')) {
    cleaned = '0' + cleaned.slice(3);
  } else if (cleaned.startsWith('61') && cleaned.length === 11) {
    cleaned = '0' + cleaned.slice(2);
  }
  // Only return valid 10-digit AU numbers
  if (/^0\d{9}$/.test(cleaned)) return cleaned;
  return cleaned || null;
}

export function contactKey(email, phone) {
  const ne = normalizeEmail(email);
  if (ne) return ne;
  const np = normalizePhone(phone);
  if (np) return `phone_${np}`;
  return null;
}

// ─── Scoring ─────────────────────────────────────────────────────────────────

const SERIOUSNESS_SCORES = {
  ready_to_buy: 100,
  very_interested: 75,
  interested: 50,
  just_browsing: 25,
};

function recencyScore(lastActivityAt) {
  if (!lastActivityAt) return 10;
  const daysSince = (Date.now() - lastActivityAt) / 86400000;
  if (daysSince <= 7) return 100;
  if (daysSince <= 30) return 60;
  if (daysSince <= 90) return 30;
  return 10;
}

export function computeBuyerScore(contact) {
  const opinionsScore = Math.min(contact.totalPriceOpinions / 20, 1) * 100;
  const seriousScore = Math.min(contact.totalRegisteredInterest / 5, 1) * 100;
  const seriousnessScore = SERIOUSNESS_SCORES[contact.seriousnessLevel] || 0;
  const likesScore = Math.min(contact.totalLikes / 10, 1) * 100;
  const recency = recencyScore(contact.lastActivityAt);

  return Math.round(
    opinionsScore * 0.2 +
    seriousScore * 0.3 +
    seriousnessScore * 0.2 +
    likesScore * 0.15 +
    recency * 0.15
  );
}

export function computeSellerScore(contact) {
  const propertiesScore = Math.min(contact.ownedPropertyIds.length / 3, 1) * 100;

  // Eagerness: isEager 0=Very serious (100), 1=Serious (60), 2=Testing (20)
  let eagernessScore = 0;
  if (contact.eagernessLevel !== null && contact.eagernessLevel !== undefined) {
    if (contact.eagernessLevel <= 0.5) eagernessScore = 100;
    else if (contact.eagernessLevel <= 1.5) eagernessScore = 60;
    else eagernessScore = 20;
  }

  const goToMarketScore = contact._hasGoToMarketSoon ? 100 : 0;
  const hasPriceScore = contact._hasPrice ? 100 : 0;

  return Math.round(
    propertiesScore * 0.3 +
    eagernessScore * 0.3 +
    goToMarketScore * 0.25 +
    hasPriceScore * 0.15
  );
}

export function deriveIntentLabel(buyerScore, sellerScore) {
  if (buyerScore >= 30 && sellerScore >= 30) return 'both';
  if (buyerScore >= 30) return 'buyer';
  if (sellerScore >= 30) return 'seller';
  return 'passive';
}

// ─── Timestamp helper ────────────────────────────────────────────────────────

function toMillis(val) {
  if (!val) return null;
  if (val.toMillis) return val.toMillis();
  if (val.seconds) return val.seconds * 1000;
  if (val._seconds) return val._seconds * 1000;
  const d = new Date(val);
  return isNaN(d.getTime()) ? null : d.getTime();
}

// ─── Main Orchestrator ───────────────────────────────────────────────────────

export async function buildAllContacts(adminDb) {
  // Fetch all collections in parallel
  const [offersSnap, propertiesSnap, usersSnap, likesSnap] = await Promise.all([
    adminDb.collection('offers').get(),
    adminDb.collection('properties').get(),
    adminDb.collection('users').get(),
    adminDb.collection('likes').get(),
  ]);

  const contactMap = {};

  function getOrCreate(key, email, phone) {
    if (!contactMap[key]) {
      contactMap[key] = {
        email: normalizeEmail(email) || null,
        phone: normalizePhone(phone) || null,
        firstName: null,
        lastName: null,
        companyName: null,
        avatar: null,
        isAgent: false,
        isHomeowner: false,
        isBuyer: false,
        totalPriceOpinions: 0,
        totalRegisteredInterest: 0,
        totalLikes: 0,
        seriousnessLevel: null,
        buyerPreferences: null,
        isFirstHomeBuyer: false,
        isInvestor: false,
        // Listings this person REGISTERED interest in (registration information). Never the listings they gave a price
        // opinion on: that would tie an identifiable buyer to an individual, anonymous price (see opinionPrivacy.js).
        registeredPropertyIds: [],
        ownedPropertyIds: [],
        eagernessLevel: null,
        buyerScore: 0,
        sellerScore: 0,
        intentLabel: 'passive',
        firstSeenAt: null,
        lastActivityAt: null,
        userId: null,
        linkedAgentIds: [],
        // Internal fields for scoring (stripped before write)
        _hasGoToMarketSoon: false,
        _hasPrice: false,
        _eagernessValues: [],
      };
    }
    return contactMap[key];
  }

  // Build a property lookup by ID for linking offers to agent
  const propertyMap = {};
  for (const doc of propertiesSnap.docs) {
    propertyMap[doc.id] = doc.data();
  }

  // Build a user lookup by uid
  const userMap = {};
  for (const doc of usersSnap.docs) {
    userMap[doc.id] = doc.data();
  }

  // ─── Process Offers → Buyer data ───────────────────────────────────────────
  const seriousnessRank = { ready_to_buy: 4, very_interested: 3, interested: 2, just_browsing: 1 };

  for (const doc of offersSnap.docs) {
    const data = doc.data();
    if (isExcludedOpinion(data)) continue; // excluded by Premarket (utils/opinionExclusion.js)
    const email = data.email || data.buyerEmail;
    const phone = data.phone || data.buyerPhone;
    const key = contactKey(email, phone);
    if (!key) continue;

    const contact = getOrCreate(key, email, phone);
    contact.isBuyer = true;

    // Name
    if (!contact.firstName && data.firstName) contact.firstName = data.firstName;
    if (!contact.lastName && data.lastName) contact.lastName = data.lastName;
    if (!contact.firstName && data.name) {
      const parts = data.name.split(' ');
      contact.firstName = parts[0] || null;
      contact.lastName = parts.slice(1).join(' ') || null;
    }

    // Count opinions (a total only: no listing, no amount). A registration stored on its own (utils/opinionRecords.js)
    // holds no price and says nothing about whether this buyer gave one, so it never counts as a price opinion.
    if ((data.type === 'opinion' || data.offerAmount) && !isRegistrationOnly(data)) {
      contact.totalPriceOpinions++;
    }

    // Count serious registrations, and which listings they are for
    if (data.serious === true) {
      contact.totalRegisteredInterest++;
      if (data.propertyId && !contact.registeredPropertyIds.includes(data.propertyId)) {
        contact.registeredPropertyIds.push(data.propertyId);
      }
    }

    // Track highest seriousness level
    const sl = data.seriousnessLevel;
    if (sl && (seriousnessRank[sl] || 0) > (seriousnessRank[contact.seriousnessLevel] || 0)) {
      contact.seriousnessLevel = sl;
    }

    // Buyer preferences
    if (data.buyerPreferences && !contact.buyerPreferences) {
      contact.buyerPreferences = data.buyerPreferences;
    }
    if (data.isFirstHomeBuyer) contact.isFirstHomeBuyer = true;
    if (data.isInvestor) contact.isInvestor = true;

    // Activity timestamps
    const offerTime = toMillis(data.createdAt);
    if (offerTime) {
      if (!contact.firstSeenAt || offerTime < contact.firstSeenAt) contact.firstSeenAt = offerTime;
      if (!contact.lastActivityAt || offerTime > contact.lastActivityAt) contact.lastActivityAt = offerTime;
    }

    // Link agent from property: only through a REGISTRATION (the buyer chose to share their details with that agent).
    // An anonymous price opinion never makes a person visible in the listing agent's contacts.
    if (data.serious === true && data.propertyId && propertyMap[data.propertyId]) {
      const prop = propertyMap[data.propertyId];
      const agentId = prop.userId || prop.agentId;
      if (agentId && !contact.linkedAgentIds.includes(agentId)) {
        contact.linkedAgentIds.push(agentId);
      }
    }
  }

  // ─── Process Properties → Homeowner data ──────────────────────────────────
  const now = Date.now();
  const THIRTY_DAYS = 30 * 86400000;

  for (const doc of propertiesSnap.docs) {
    const data = doc.data();
    const email = data.clientEmail;
    const phone = data.clientPhone;
    const key = contactKey(email, phone);
    if (!key) continue;

    const contact = getOrCreate(key, email, phone);
    contact.isHomeowner = true;

    // Name from client fields
    if (!contact.firstName && data.clientName) {
      const parts = data.clientName.split(' ');
      contact.firstName = parts[0] || null;
      contact.lastName = parts.slice(1).join(' ') || null;
    }

    // Owned properties
    if (!contact.ownedPropertyIds.includes(doc.id)) {
      contact.ownedPropertyIds.push(doc.id);
    }

    // Eagerness tracking
    const eager = data.isEager;
    if (eager !== undefined && eager !== null) {
      // Handle legacy format (>=70 means serious) and new format (0,1,2)
      const eagerVal = typeof eager === 'number' && eager >= 70 ? 0 : Number(eager);
      if (!isNaN(eagerVal)) {
        contact._eagernessValues.push(eagerVal);
      }
    }

    // Go-to-market within 30 days
    const gtm = toMillis(data.gotoMarketGoal);
    if (gtm && gtm > now && gtm <= now + THIRTY_DAYS) {
      contact._hasGoToMarketSoon = true;
    }

    // Has price set
    const price = parseFloat(String(data.price || '').replace(/[^0-9.]/g, ''));
    if (!isNaN(price) && price > 0) {
      contact._hasPrice = true;
    }

    // Activity timestamp
    const propTime = toMillis(data.createdAt);
    if (propTime) {
      if (!contact.firstSeenAt || propTime < contact.firstSeenAt) contact.firstSeenAt = propTime;
      if (!contact.lastActivityAt || propTime > contact.lastActivityAt) contact.lastActivityAt = propTime;
    }
  }

  // ─── Process Users → Link userId, agent flag, avatar ──────────────────────
  for (const doc of usersSnap.docs) {
    const data = doc.data();
    const email = normalizeEmail(data.email);
    if (!email) continue;

    const key = contactKey(data.email, data.phone);
    if (!key) continue;

    // Only update existing contacts or agents
    if (contactMap[key]) {
      const contact = contactMap[key];
      contact.userId = doc.id;
      if (data.agent === true) contact.isAgent = true;
      if (data.companyName) contact.companyName = data.companyName;
      if (data.avatar || data.photoURL) contact.avatar = data.avatar || data.photoURL;
      if (!contact.firstName && data.firstName) contact.firstName = data.firstName;
      if (!contact.lastName && data.lastName) contact.lastName = data.lastName;
      if (!contact.firstName && data.displayName) {
        const parts = data.displayName.split(' ');
        contact.firstName = parts[0] || null;
        contact.lastName = parts.slice(1).join(' ') || null;
      }
    }
  }

  // ─── Process Likes → Buyer engagement ─────────────────────────────────────
  for (const doc of likesSnap.docs) {
    const data = doc.data();
    // Likes may have userId but not email — try to match via user lookup
    const userId = data.userId;
    let email = data.email;
    let phone = data.phone;

    if (!email && userId && userMap[userId]) {
      email = userMap[userId].email;
      phone = userMap[userId].phone;
    }

    const key = contactKey(email, phone);
    if (!key) continue;

    if (contactMap[key]) {
      contactMap[key].totalLikes++;
      const likeTime = toMillis(data.createdAt);
      if (likeTime && likeTime > (contactMap[key].lastActivityAt || 0)) {
        contactMap[key].lastActivityAt = likeTime;
      }
    }
  }

  // ─── Compute scores for all contacts ──────────────────────────────────────
  const contacts = [];
  for (const [key, contact] of Object.entries(contactMap)) {
    // Compute average eagerness
    if (contact._eagernessValues.length > 0) {
      contact.eagernessLevel =
        contact._eagernessValues.reduce((a, b) => a + b, 0) / contact._eagernessValues.length;
    }

    // Compute scores
    contact.buyerScore = contact.isBuyer ? computeBuyerScore(contact) : 0;
    contact.sellerScore = contact.isHomeowner ? computeSellerScore(contact) : 0;
    contact.intentLabel = deriveIntentLabel(contact.buyerScore, contact.sellerScore);

    // Clean internal fields
    delete contact._hasGoToMarketSoon;
    delete contact._hasPrice;
    delete contact._eagernessValues;

    contacts.push({ _key: key, ...contact });
  }

  return contacts;
}

// ─── Write to Firestore ──────────────────────────────────────────────────────

export async function writeContacts(adminDb, contacts) {
  const { FieldValue } = await import('firebase-admin/firestore');

  for (let i = 0; i < contacts.length; i += 500) {
    const batch = adminDb.batch();
    const chunk = contacts.slice(i, i + 500);

    for (const contact of chunk) {
      const key = contact._key;
      // opinionPropertyIds (the listings a person gave a price opinion on) is no longer kept: removed from every stored
      // contact on its next recompute, since these writes merge.
      const doc = { ...contact, opinionPropertyIds: FieldValue.delete(), computedAt: FieldValue.serverTimestamp() };
      delete doc._key;

      // Convert timestamps to Firestore Timestamps
      if (doc.firstSeenAt) {
        doc.firstSeenAt = new Date(doc.firstSeenAt);
      }
      if (doc.lastActivityAt) {
        doc.lastActivityAt = new Date(doc.lastActivityAt);
      }

      const ref = adminDb.collection('contacts').doc(key);
      batch.set(ref, doc, { merge: true });
    }

    await batch.commit();
  }
}
