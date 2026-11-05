import { FieldValue } from 'firebase-admin/firestore';
import { createHash } from 'node:crypto';
import { recordPropertyCharge } from './billingService';
import { pickNotificationUser } from '../../utils/notificationUser';
import { sendCampaignLinkOnce } from './agentNotificationService';

/**
 * Office- and team-managed campaigns, built on the EXISTING property model (no second campaign system).
 *
 *  - A managed campaign is an ordinary `properties` document whose `userId` is the ASSIGNED AGENT. Agent
 *    dashboards, public links, reports, kiosk, registrations and billing attribution all key on `userId`
 *    exactly as before, so nothing downstream changes.
 *  - The creating administrator is recorded separately (`createdByUid`, `createdByRole`, `managedCreation`)
 *    and in the server-only `officeCampaignAudit` collection. They never become the owner.
 *  - Authority is evaluated LIVE on every request from current office/team membership; nothing about it is
 *    stored on the campaign. So moving an agent between teams never transfers ownership, and a former team
 *    creator loses management access the moment the agent leaves that team.
 *  - The assigned agent needs a Firebase Auth uid (active, or invited-but-not-yet-activated). Agents who
 *    are only a staged import row have no account and cannot own a campaign; this never creates Auth users.
 *  - Billing is untouched: the same recordPropertyCharge(), idempotent per property, runs for the owner's
 *    existing billing entity, exactly as when the agent creates the campaign themself.
 */

export class ManagedCampaignError extends Error {
  constructor(message, status = 400, code) {
    super(message);
    this.name = 'ManagedCampaignError';
    this.status = status;
    this.code = code;
  }
}

// The agent wizard sets vendorUploaded: true. The ONLY reader we found is the legacy Cloud Function
// `onVendorPropertyCreated` (still deployed and active: it last sent on 2026-11-03), which emails the property OWNER
// "Property Added to Your Dashboard" whenever a new property has this flag. For a managed campaign the owner is the
// assigned agent, who already gets the once-only campaign-link email, so leaving the flag off avoids a confusing duplicate
// (including to agents who have never logged in). No other reader exists in the website or functions repos; the mobile app
// is unverified. Revert to true only if something is found to need it (docs/release/OFFICE_WORKSPACE_RELEASE.md).
export const MANAGED_VENDOR_UPLOADED = false;

const displayName = (u) => `${u?.firstName || ''} ${u?.lastName || ''}`.trim() || null;
const isAgentUser = (u) => !!(u?.agent || u?.isAgent || u?.roles?.includes?.('agent'));

async function loadUser(db, uid) {
  const s = await db.collection('users').doc(uid).get();
  return s.exists ? { uid, ...s.data() } : null;
}

async function loadActiveOffice(db, officeId) {
  if (!officeId) return null;
  const s = await db.collection('officeAdminInfo').doc(officeId).get();
  if (!s.exists || s.data().status !== 'active') return null;
  return { id: officeId, ...s.data() };
}

/**
 * The actor's authority over `owner`'s campaigns, evaluated live:
 *   'officeAdmin' — actor administers the office the owner CURRENTLY belongs to (active office)
 *   'teamAdmin'   — actor created the team the owner is CURRENTLY in (same office) — no wider reach
 *   null          — nothing (an agent has no authority over anyone else's campaigns)
 * A user is never "managed" by themself here; self-created campaigns use the existing agent flow.
 */
export async function resolveManagementRole(db, { actorUid, owner }) {
  if (!actorUid || !owner?.uid || actorUid === owner.uid) return null;
  if (!owner.officeId) return null;
  const office = await loadActiveOffice(db, owner.officeId);
  if (!office) return null;
  if (Array.isArray(office.officeAdminUids) && office.officeAdminUids.includes(actorUid)) {
    const actor = await loadUser(db, actorUid);
    if (actor?.officeId === owner.officeId) return 'officeAdmin';
    return null;
  }
  const actor = await loadUser(db, actorUid);
  if (!actor || actor.officeId !== owner.officeId || !actor.teamId || actor.teamId !== owner.teamId) return null;
  const team = await db.collection('teams').doc(actor.teamId).get();
  if (!team.exists || team.data().officeId !== owner.officeId || team.data().createdBy !== actorUid) return null;
  return 'teamAdmin';
}

/** Agents the actor may create campaigns for. Office admin: every office user with an account. Team creator: own team. */
export async function listAssignableAgents(db, actorUid) {
  const actor = await loadUser(db, actorUid);
  if (!actor?.officeId) return { role: null, agents: [] };
  const office = await loadActiveOffice(db, actor.officeId);
  if (!office) return { role: null, agents: [] };

  let role = null;
  let docs = [];
  if (Array.isArray(office.officeAdminUids) && office.officeAdminUids.includes(actorUid)) {
    role = 'officeAdmin';
    docs = (await db.collection('users').where('officeId', '==', actor.officeId).get()).docs;
  } else if (actor.teamId) {
    const team = await db.collection('teams').doc(actor.teamId).get();
    if (team.exists && team.data().officeId === actor.officeId && team.data().createdBy === actorUid) {
      role = 'teamAdmin';
      docs = (await db.collection('users').where('teamId', '==', actor.teamId).get()).docs
        .filter((d) => d.data().officeId === actor.officeId);
    }
  }
  if (!role) return { role: null, agents: [] };
  // Show the office-managed professional name and photo (the same profile the directory and public pages use), so the
  // selector agrees with everything else. A failed lookup falls back to the login-record values.
  const profiles = new Map();
  try {
    const snap = await db.collection('officeAgents').where('officeId', '==', actor.officeId).get();
    const byUid = new Map();
    for (const d of snap.docs) { const p = d.data(); if (p.linkedUid) byUid.set(p.linkedUid, [...(byUid.get(p.linkedUid) || []), p]); }
    for (const [uid, list] of byUid) if (list.length === 1) profiles.set(uid, list[0]); // ambiguous = ignored, as everywhere
  } catch { /* fall back to login-record values */ }
  const agents = docs
    .filter((d) => d.id !== actorUid && isAgentUser(d.data()))
    .map((d) => {
      const u = d.data();
      const prof = profiles.get(d.id);
      const real = (v) => (typeof v === 'string' && v.trim() ? v.trim() : null);
      return {
        uid: d.id, name: real(prof?.fullName) || displayName(u), email: u.email || null, photoUrl: real(prof?.photoUrl) || u.avatar || null,
        loginStatus: u.accountStatus === 'invited' ? 'invited' : 'active',
      };
    })
    .sort((a, b) => (a.name || a.email || '').localeCompare(b.name || b.email || ''));
  return { role, agents };
}

/* ───────────────────────── input → property document ───────────────────────── */

const num = (v) => { const n = Number(v); return Number.isFinite(n) && n >= 0 && n < 1e12 ? n : null; };
const str = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const MAX_IMAGES = 60;

/**
 * Allowlist, never a pass-through. Server-controlled fields (userId, billing/agent flags, stats, terms,
 * visibility defaults) are set here and can never come from the client.
 */
export function sanitizePropertyInput(input) {
  if (!input || typeof input !== 'object') throw new ManagedCampaignError('Invalid campaign details');
  const address = str(input.address, 300);
  if (!address) throw new ManagedCampaignError('A property address is required');
  const imageUrls = Array.isArray(input.imageUrls) ? input.imageUrls : [];
  if (imageUrls.length > MAX_IMAGES) throw new ManagedCampaignError('Too many photos');
  for (const u of imageUrls) {
    if (typeof u !== 'string' || !/^https:\/\/[^\s"'<>]+$/.test(u) || u.length > 1000) throw new ManagedCampaignError('Photos must be https image links');
  }
  const loc = input.location && typeof input.location === 'object' ? input.location : null;
  const latitude = loc ? Number(loc.latitude) : NaN;
  const longitude = loc ? Number(loc.longitude) : NaN;
  // Same "x% y%" format the wizard's positioner produces (may carry decimals or an exponent); clamp to 0-100.
  const fm = typeof input.heroFocalPoint === 'string' ? input.heroFocalPoint.match(/^(-?\d+(?:\.\d+)?(?:e[+-]?\d+)?)% (-?\d+(?:\.\d+)?(?:e[+-]?\d+)?)%$/i) : null;
  const focal = fm && Number.isFinite(Number(fm[1])) && Number.isFinite(Number(fm[2]))
    ? `${Math.min(100, Math.max(0, Number(fm[1])))}% ${Math.min(100, Math.max(0, Number(fm[2])))}%` : null;
  const listingStatus = input.listingStatus === 'on-market' ? 'on-market' : 'premarket';
  const price = String(input.price ?? '').replace(/[^0-9]/g, '');
  if (!price) throw new ManagedCampaignError('An estimated price is required');
  return {
    address,
    formattedAddress: str(input.formattedAddress, 300) || address,
    bathrooms: num(input.bathrooms), bedrooms: num(input.bedrooms), carSpaces: num(input.carSpaces),
    description: str(input.description, 10000),
    imageUrls,
    ...(focal ? { heroFocalPoint: focal } : {}),
    features: (Array.isArray(input.features) ? input.features : []).filter((f) => typeof f === 'string').map((f) => f.slice(0, 60)).slice(0, 50),
    location: Number.isFinite(latitude) && Number.isFinite(longitude) && Math.abs(latitude) <= 90 && Math.abs(longitude) <= 180 ? { latitude, longitude } : null,
    price,
    squareFootage: str(String(input.squareFootage ?? ''), 20),
    title: str(input.title, 200),
    propertyType: Number.isInteger(input.propertyType) && input.propertyType >= 1 && input.propertyType <= 20 ? input.propertyType : null,
    listingStatus,
    showSuburbOnly: input.showSuburbOnly === true,
  };
}

const propertyIdFor = ({ actorUid, ownerUid, requestId }) =>
  `m_${createHash('sha256').update(`${actorUid}:${ownerUid}:${requestId}`).digest('hex').slice(0, 24)}`;

const isAlreadyExists = (err) => err?.code === 6 || /ALREADY_EXISTS/i.test(err?.message || '');

/**
 * Creates the campaign for `ownerUid` on behalf of `actorUid`. Idempotent on (actor, owner, requestId):
 * a double-submit or retry returns the SAME campaign and never creates a second record or charge.
 */
export async function createManagedProperty(db, { actorUid, ownerUid, requestId, input, acceptTerms }) {
  if (acceptTerms !== true) throw new ManagedCampaignError('The campaign terms must be accepted to continue.');
  if (typeof requestId !== 'string' || !/^[A-Za-z0-9-]{16,64}$/.test(requestId)) throw new ManagedCampaignError('Missing request id');
  if (typeof ownerUid !== 'string' || !ownerUid) throw new ManagedCampaignError('Choose the agent this campaign is for');

  const owner = await loadUser(db, ownerUid);
  if (!owner || !isAgentUser(owner)) throw new ManagedCampaignError('Agent not found', 404);
  // Active or invited (never logged in) accounts only: not suspended, disabled or deactivated ones.
  if ((owner.accountStatus && !['active', 'invited'].includes(owner.accountStatus)) || owner.disabled === true || owner.deactivated === true) {
    throw new ManagedCampaignError('Agent not found', 404);
  }
  const role = await resolveManagementRole(db, { actorUid, owner });
  // 404, not 403: never confirm that an agent outside the actor's reach exists.
  if (!role) throw new ManagedCampaignError('Agent not found', 404);

  const fields = sanitizePropertyInput(input);
  const id = propertyIdFor({ actorUid, ownerUid, requestId });
  const data = {
    ...fields,
    createdAt: FieldValue.serverTimestamp(),
    imageUploadProgress: { uploaded: fields.imageUrls.length, total: fields.imageUrls.length, inProgress: false },
    priceHistory: [], toPrice: null, showPriceRange: false, offPlan: false, postcode: '',
    active: true, visibility: false, acceptingOffers: true,
    campaignId: 'FqMZd0mWlNlSBl66s7BN',
    isEager: null, clientName: null, clientEmail: null, clientPhone: null,
    wantsPremiumListing: false, agent: true, vendorUploaded: MANAGED_VENDOR_UPLOADED, agentManaged: true,
    // Ownership = the assigned agent. The listing-agent display profile (`agentId`) is not set: the public
    // page shows the owner's professional profile (see publicProfileService).
    userId: ownerUid, agentId: null, agentName: null, agentAvatar: null,
    stats: { views: 0 },
    // The admin accepted the campaign terms on the agent's behalf; recorded, never implied.
    termsAcceptedAt: FieldValue.serverTimestamp(), termsAcceptedBy: actorUid,
    // Attribution/audit (separate from ownership).
    managedCreation: true, createdByUid: actorUid, createdByRole: role,
  };

  const ref = db.collection('properties').doc(id);
  let duplicate = false;
  try {
    await ref.create(data);
  } catch (err) {
    if (!isAlreadyExists(err)) throw err;
    duplicate = true;
  }
  if (duplicate) return { propertyId: id, duplicate: true };

  // Same side-effects the existing agent flow performs after creating a property.
  try { await db.collection('draftProperties').doc(id).set({ ...data, override: true }); } catch (e) { console.error('draftProperties write failed', id, e.message); }
  try {
    await db.collection('notifications').add({
      property: data, createdAt: new Date(), read: false, type: 'newProspect',
      user: pickNotificationUser(owner, ownerUid),
    });
  } catch (e) { console.error('notification write failed', id, e.message); }
  let charge = null;
  try {
    // Billing is exactly the existing rule, attributed to the owner. Best-effort like the agent flow: the
    // monthly run sweeps any property missing a charge.
    charge = await recordPropertyCharge({ id, ...data, createdAt: new Date() });
  } catch (e) { console.error('Failed to record managed property charge (monthly run will catch it):', id, e.message); }
  try {
    await db.collection('officeCampaignAudit').add({
      action: 'campaign.create', propertyId: id, ownerUid, actorUid, actorRole: role,
      officeId: owner.officeId, at: FieldValue.serverTimestamp(),
    });
  } catch (e) { console.error('audit write failed', id, e.message); }

  // Email the ASSIGNED agent their campaign link (once; a retry or double-submit never re-sends). Failure never
  // affects the campaign: it is logged in emailLog and an authorised admin can resend.
  let notification = 'error';
  try { notification = (await sendCampaignLinkOnce({ propertyId: id, recipientUid: ownerUid, seq: 1 })).reason || 'sent'; } catch (e) { console.error('campaign link email failed', id, e.message); }

  return { propertyId: id, duplicate: false, role, charge: charge?.reason || (charge?.created ? 'recorded' : null), notification };
}

/**
 * Manage an existing campaign on the owner's behalf. Deliberately narrow: show/hide the buyer link and
 * archive. Ownership, price, details and billing are never changed here.
 */
export async function updateManagedProperty(db, { actorUid, propertyId, action }) {
  if (!['show', 'hide', 'archive'].includes(action)) throw new ManagedCampaignError('Unknown action');
  const ref = db.collection('properties').doc(propertyId);
  const snap = await ref.get();
  if (!snap.exists) throw new ManagedCampaignError('Campaign not found', 404);
  const property = snap.data();
  const owner = property.userId ? await loadUser(db, property.userId) : null;
  const role = owner ? await resolveManagementRole(db, { actorUid, owner }) : null;
  if (!role) throw new ManagedCampaignError('Campaign not found', 404);

  const patch = action === 'show' ? { visibility: true }
    : action === 'hide' ? { visibility: false }
      : { archived: true, visibility: false };
  await ref.update(patch);
  try {
    await db.collection('officeCampaignAudit').add({
      action: `campaign.${action}`, propertyId, ownerUid: property.userId, actorUid, actorRole: role,
      officeId: owner.officeId, at: FieldValue.serverTimestamp(),
    });
  } catch (e) { console.error('audit write failed', propertyId, e.message); }
  return { propertyId, role, ...patch };
}

/* ───────────────────────── campaign lists (no buyer data) ───────────────────────── */

const toIso = (t) => (t?.toDate ? t.toDate().toISOString() : t || null);
const chunk = (arr, n) => Array.from({ length: Math.ceil(arr.length / n) }, (_, i) => arr.slice(i * n, i * n + n));

/** Campaign summary for lists: address, owner, who created it, links. Never offers, opinions or buyers. */
export const toCampaignSummary = (id, p, owner) => ({
  id,
  // The existing app keeps the full street address in formattedAddress; `address` is suburb-level.
  address: p.formattedAddress || p.address || null,
  imageUrl: Array.isArray(p.imageUrls) && p.imageUrls[0] ? p.imageUrls[0] : null,
  ownerUid: p.userId,
  ownerName: displayName(owner) || null,
  ownerEmail: owner?.email || null,
  ownerLoginStatus: owner?.accountStatus === 'invited' ? 'invited' : 'active',
  managed: p.managedCreation === true,
  createdByUid: p.createdByUid || null,
  createdByRole: p.createdByRole || null,
  visibility: p.visibility === true,
  archived: p.archived === true,
  sold: p.listingStatus === 'sold' || p.sold === true,
  createdAt: toIso(p.createdAt),
});

/** Every non-hidden campaign owned by someone currently in the office. Caller has verified office admin. */
export async function listOfficeCampaigns(db, officeId) {
  const users = (await db.collection('users').where('officeId', '==', officeId).get()).docs;
  const owners = new Map(users.map((d) => [d.id, d.data()]));
  const out = [];
  for (const ids of chunk([...owners.keys()], 10)) {
    const snap = await db.collection('properties').where('userId', 'in', ids).get();
    for (const d of snap.docs) {
      const p = d.data();
      if (p.hidden === true) continue;
      out.push(toCampaignSummary(d.id, p, owners.get(p.userId)));
    }
  }
  return out.sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
}

/**
 * Resend the campaign link to the agent the campaign belongs to. Allowed for the owner, an office admin of
 * their office, or the creator of their team (live check). A resend is a NEW once-only event (seq + 1) and is
 * rate-limited, so it can be repeated deliberately but never by accident.
 */
const RESEND_COOLDOWN_MS = 60 * 1000;
export async function resendCampaignLink(db, { actorUid, propertyId }) {
  const ref = db.collection('properties').doc(propertyId);
  const snap = await ref.get();
  if (!snap.exists) throw new ManagedCampaignError('Campaign not found', 404);
  const property = snap.data();
  const owner = property.userId ? await loadUser(db, property.userId) : null;
  if (!owner) throw new ManagedCampaignError('Campaign not found', 404);
  const role = actorUid === owner.uid ? 'owner' : await resolveManagementRole(db, { actorUid, owner });
  if (!role) throw new ManagedCampaignError('Campaign not found', 404);

  const last = Number(property.campaignLinkResentAtMs || 0);
  if (Date.now() - last < RESEND_COOLDOWN_MS) throw new ManagedCampaignError('The link was just sent. Please wait a minute before sending it again.', 429, 'cooldown');
  const seq = Math.max(1, Number(property.campaignLinkSeq || 1)) + 1;
  await ref.update({ campaignLinkSeq: seq, campaignLinkResentAtMs: Date.now() });
  const result = await sendCampaignLinkOnce({ propertyId, recipientUid: owner.uid, seq });
  try {
    await db.collection('officeCampaignAudit').add({
      action: 'campaign.resendLink', propertyId, ownerUid: owner.uid, actorUid, actorRole: role,
      officeId: owner.officeId || null, result: result.reason || (result.sent ? 'sent' : 'not-sent'), at: FieldValue.serverTimestamp(),
    });
  } catch (e) { console.error('audit write failed', propertyId, e.message); }
  return { propertyId, sent: result.sent === true, reason: result.sent ? null : result.reason };
}
