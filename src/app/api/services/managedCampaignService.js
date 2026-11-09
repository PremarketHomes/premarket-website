import { FieldValue } from 'firebase-admin/firestore';
import { createHash } from 'node:crypto';
import { recordPropertyCharge, buildTestCampaignExclusion } from './billingService';
import { canCreateTestCampaign, loadTestCampaignIds, TEST_CAMPAIGN_EXEMPTION_REASON } from './testCampaigns';
import { pickNotificationUser } from '../../utils/notificationUser';
import { sendCampaignLinkOnce } from './agentNotificationService';
import { loadActiveOffice, isActiveBso, getBsoAccess, bsoUidsOf, isUsableAccount } from './bsoService';

/**
 * Office-managed campaigns, built on the EXISTING property model (no second campaign system).
 *
 * Every managed campaign has three separate identities:
 *  - SELLING AGENT = the owner, `userId`. Agent dashboards, public buyer pages, cards, kiosk, registrations and billing
 *    attribution all key on `userId` exactly as before, so the selling agent is what buyers see and nothing downstream changes.
 *  - MANAGING USER = `managedByUid`: the BSO (or office admin) responsible for running the campaign. Never shown publicly.
 *  - CREATED BY   = `createdByUid` / `createdByRole`: the original uploader, kept for audit and never changed.
 *
 *  Who may do what is evaluated LIVE on every request (resolveCampaignRole), never stored as a grant:
 *  - owner        the selling agent (unchanged: full control of their own campaign)
 *  - officeAdmin  an administrator of the office the owner CURRENTLY belongs to: every campaign in the office
 *  - bso          the campaign's `managedByUid`, while they still hold the BSO role in the owner's office
 *  Formal team membership grants nothing here (the separate read-only teammate view lives in propertyAccessService).
 *  Reassigning the manager changes only `managedByUid`: the selling agent, creator and billing never move.
 *
 *  - The selling agent needs a Firebase Auth uid (active, or invited-but-not-yet-activated). Staged import rows have
 *    no account and cannot own a campaign; this never creates Auth users.
 *  - Billing is untouched: the same recordPropertyCharge(), idempotent per property, runs for the owner's existing
 *    billing entity (the office), exactly as when the agent creates the campaign themself.
 *  - Changes are audited in the server-only `officeCampaignAudit` collection.
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
const adminUidsOf = (office) => (Array.isArray(office?.officeAdminUids) ? office.officeAdminUids : []);
const real = (v) => (typeof v === 'string' && v.trim() ? v.trim() : null);
const norm = (n) => String(n || '').trim().replace(/\s+/g, ' ').toLowerCase();

async function loadUser(db, uid) {
  if (!uid) return null;
  const s = await db.collection('users').doc(uid).get();
  return s.exists ? { uid, ...s.data() } : null;
}

async function audit(db, entry) {
  try {
    await db.collection('officeCampaignAudit').add({ ...entry, at: FieldValue.serverTimestamp() });
  } catch (e) { console.error('audit write failed', entry.propertyId, e.message); }
}

/** Office-managed professional names/photos (the profile the directory and public pages use), keyed by linked uid. */
async function loadOfficeProfiles(db, officeId) {
  const profiles = new Map();
  try {
    const snap = await db.collection('officeAgents').where('officeId', '==', officeId).get();
    const byUid = new Map();
    for (const d of snap.docs) { const p = d.data(); if (p.linkedUid) byUid.set(p.linkedUid, [...(byUid.get(p.linkedUid) || []), p]); }
    for (const [uid, list] of byUid) if (list.length === 1) profiles.set(uid, list[0]); // ambiguous = ignored, as everywhere
  } catch { /* fall back to login-record values */ }
  return profiles;
}

const personView = (uid, u, profiles) => {
  const prof = profiles?.get(uid);
  return {
    uid,
    name: real(prof?.fullName) || displayName(u),
    photoUrl: real(prof?.photoUrl) || u?.avatar || null,
    loginStatus: u?.accountStatus === 'invited' ? 'invited' : 'active',
  };
};

/* ───────────────────────── authority (always live) ───────────────────────── */

/**
 * Office-admin authority over `owner`: 'officeAdmin' when the actor administers the office the owner CURRENTLY belongs
 * to (active office, actor in the same office), else null. A user never "manages" themself here.
 */
export async function resolveManagementRole(db, { actorUid, owner }) {
  if (!actorUid || !owner?.uid || actorUid === owner.uid || !owner.officeId) return null;
  const office = await loadActiveOffice(db, owner.officeId);
  if (!office || !adminUidsOf(office).includes(actorUid)) return null;
  const actor = await loadUser(db, actorUid);
  return actor?.officeId === owner.officeId ? 'officeAdmin' : null;
}

/** Who may CREATE a campaign for `owner`: an office admin or a BSO of the owner's current office. */
export async function resolveCreatorRole(db, { actorUid, owner }) {
  if (!actorUid || !owner?.uid || actorUid === owner.uid || !owner.officeId) return null;
  const office = await loadActiveOffice(db, owner.officeId);
  if (!office) return null;
  const actor = await loadUser(db, actorUid);
  if (actor?.officeId !== owner.officeId) return null;
  if (adminUidsOf(office).includes(actorUid)) return 'officeAdmin';
  if (await isActiveBso(db, { uid: actorUid, officeId: owner.officeId, office })) return 'bso';
  return null;
}

/**
 * The actor's authority over ONE campaign: 'owner' | 'officeAdmin' | 'bso' | null. A BSO's authority comes only from
 * being this campaign's `managedByUid` while holding the BSO role in the owner's office: never from creating other
 * campaigns for the same agent, and never from team membership.
 */
export async function resolveCampaignRole(db, { actorUid, property, owner: knownOwner }) {
  if (!actorUid || !property?.userId) return null;
  if (property.userId === actorUid) return 'owner';
  const owner = knownOwner || await loadUser(db, property.userId);
  if (!owner?.officeId) return null;
  const office = await loadActiveOffice(db, owner.officeId);
  if (!office) return null;
  if (adminUidsOf(office).includes(actorUid)) {
    const actor = await loadUser(db, actorUid);
    return actor?.officeId === owner.officeId ? 'officeAdmin' : null;
  }
  if (property.managedByUid === actorUid && await isActiveBso(db, { uid: actorUid, officeId: owner.officeId, office })) return 'bso';
  return null;
}

/**
 * Agents the actor may create campaigns for. Office admin or BSO: every agent in their office with a usable account
 * (active or invited, i.e. including agents who have never logged in). Office admins also get the office's BSOs, so
 * they can choose who manages a campaign they create.
 */
export async function listAssignableAgents(db, actorUid) {
  const actor = await loadUser(db, actorUid);
  if (!actor?.officeId) return { role: null, agents: [] };
  const office = await loadActiveOffice(db, actor.officeId);
  if (!office) return { role: null, agents: [] };
  let role = null;
  if (adminUidsOf(office).includes(actorUid)) role = 'officeAdmin';
  else if (await isActiveBso(db, { uid: actorUid, officeId: actor.officeId, office })) role = 'bso';
  if (!role) return { role: null, agents: [] };

  const [docs, profiles] = await Promise.all([
    db.collection('users').where('officeId', '==', actor.officeId).get().then((s) => s.docs),
    loadOfficeProfiles(db, actor.officeId),
  ]);
  const agents = docs
    .filter((d) => d.id !== actorUid && isAgentUser(d.data()) && isUsableAccount(d.data()))
    .map((d) => ({ ...personView(d.id, d.data(), profiles), email: d.data().email || null }))
    .sort((a, b) => (a.name || a.email || '').localeCompare(b.name || b.email || ''));
  // Whether this verified account may tick "Test campaign" (server decides; the allowlist never reaches the browser).
  const testCampaignAllowed = canCreateTestCampaign(actorUid);
  if (role !== 'officeAdmin') return { role, agents, testCampaignAllowed };
  const bsos = docs
    .filter((d) => bsoUidsOf(office).includes(d.id) && isUsableAccount(d.data()))
    .map((d) => ({ uid: d.id, name: personView(d.id, d.data(), profiles).name || d.data().email || 'BSO' }))
    .sort((a, b) => a.name.localeCompare(b.name));
  return { role, agents, bsos, testCampaignAllowed };
}

/* ───────────────────────── input → property document ───────────────────────── */

const num = (v) => { const n = Number(v); return Number.isFinite(n) && n >= 0 && n < 1e12 ? n : null; };
const str = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const MAX_IMAGES = 60;
const isHttpsImage = (u) => typeof u === 'string' && /^https:\/\/[^\s"'<>]+$/.test(u) && u.length <= 1000;

/**
 * Allowlist, never a pass-through. Server-controlled fields (userId, managedByUid, billing/agent flags, stats, terms,
 * visibility defaults) are set here and can never come from the client.
 */
export function sanitizePropertyInput(input) {
  if (!input || typeof input !== 'object') throw new ManagedCampaignError('Invalid campaign details');
  const address = str(input.address, 300);
  if (!address) throw new ManagedCampaignError('A property address is required');
  const imageUrls = Array.isArray(input.imageUrls) ? input.imageUrls : [];
  if (imageUrls.length > MAX_IMAGES) throw new ManagedCampaignError('Too many photos');
  for (const u of imageUrls) {
    if (!isHttpsImage(u)) throw new ManagedCampaignError('Photos must be https image links');
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
 * Creates the campaign for `ownerUid` (the selling agent) on behalf of `actorUid`. Idempotent on (actor, owner, requestId):
 * a double-submit or retry returns the SAME campaign and never creates a second record, charge or email.
 * The manager is the creating BSO; an office admin manages it themself unless they choose one of the office's BSOs.
 */
export async function createManagedProperty(db, { actorUid, ownerUid, requestId, input, acceptTerms, managerUid, testCampaign }) {
  if (acceptTerms !== true) throw new ManagedCampaignError('The campaign terms must be accepted to continue.');
  if (typeof requestId !== 'string' || !/^[A-Za-z0-9-]{16,64}$/.test(requestId)) throw new ManagedCampaignError('Missing request id');
  if (typeof ownerUid !== 'string' || !ownerUid) throw new ManagedCampaignError('Choose the selling agent for this campaign');
  // Test campaign: only the verified creator on the allowlist, only when explicitly requested (strictly `true`).
  const isTest = testCampaign === true;
  if (testCampaign != null && testCampaign !== false && !isTest) throw new ManagedCampaignError('Invalid test campaign value');
  if (isTest && !canCreateTestCampaign(actorUid)) throw new ManagedCampaignError('Test campaigns are not available for this account.', 403);

  const owner = await loadUser(db, ownerUid);
  if (!owner || !isAgentUser(owner) || !isUsableAccount(owner)) throw new ManagedCampaignError('Agent not found', 404);
  const role = await resolveCreatorRole(db, { actorUid, owner });
  // 404, not 403: never confirm that an agent outside the actor's reach exists.
  if (!role) throw new ManagedCampaignError('Agent not found', 404);

  let managedByUid = actorUid;
  if (managerUid != null && managerUid !== '' && managerUid !== actorUid) {
    if (role !== 'officeAdmin') throw new ManagedCampaignError('A BSO manages the campaigns they create.');
    if (typeof managerUid !== 'string' || !(await isActiveBso(db, { uid: managerUid, officeId: owner.officeId }))) {
      throw new ManagedCampaignError('Choose a BSO from your office to manage this campaign.');
    }
    managedByUid = managerUid;
  }

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
    // Ownership = the selling agent. The listing-agent display profile (`agentId`) is not set: the public page shows the
    // owner's professional profile (see publicProfileService / utils/listingAgent.js), so the manager is never shown.
    userId: ownerUid, agentId: null, agentName: null, agentAvatar: null,
    stats: { views: 0 },
    // The creator accepted the campaign terms on the agent's behalf; recorded, never implied.
    termsAcceptedAt: FieldValue.serverTimestamp(), termsAcceptedBy: actorUid,
    // Management (live authority) and attribution/audit, both separate from ownership.
    managedByUid,
    managedCreation: true, createdByUid: actorUid, createdByRole: role,
    // Display hint only; the server-only billing record below is what billing, reporting and emails rely on.
    ...(isTest ? { testCampaign: true, testCampaignBy: actorUid } : {}),
  };

  const ref = db.collection('properties').doc(id);
  let duplicate = false;
  try {
    if (isTest) {
      // The property and its non-billable billing record land together or not at all: no sweep can slip a
      // pending charge in between.
      const exclusion = await buildTestCampaignExclusion({
        propertyId: id, propertyAddress: data.address || data.formattedAddress, agentUserId: ownerUid,
        approvedByUid: actorUid, reason: TEST_CAMPAIGN_EXEMPTION_REASON,
      });
      const batch = db.batch();
      batch.create(ref, data);
      batch.create(db.collection('propertyCharges').doc(id), exclusion);
      await batch.commit();
    } else {
      await ref.create(data);
    }
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
  if (!isTest) { // a test campaign already has its excluded billing record (written with the property above)
    try {
      // Billing is exactly the existing rule, attributed to the owner. Best-effort like the agent flow: the
      // monthly run sweeps any property missing a charge.
      charge = await recordPropertyCharge({ id, ...data, createdAt: new Date() });
    } catch (e) { console.error('Failed to record managed property charge (monthly run will catch it):', id, e.message); }
  }
  await audit(db, { action: 'campaign.create', propertyId: id, ownerUid, actorUid, actorRole: role, managedByUid, officeId: owner.officeId, ...(isTest ? { testCampaign: true } : {}) });
  if (isTest) {
    await audit(db, { action: 'campaign.testCampaignBillingExempt', propertyId: id, ownerUid, actorUid, actorRole: role, officeId: owner.officeId, reason: TEST_CAMPAIGN_EXEMPTION_REASON });
  }

  // Email the SELLING AGENT their campaign link (once; a retry or double-submit never re-sends). Failure never
  // affects the campaign: it is logged in emailLog and an authorised user can resend. Test campaigns too: apart from
  // billing they behave exactly like any other campaign.
  let notification = 'error';
  try { notification = (await sendCampaignLinkOnce({ propertyId: id, recipientUid: ownerUid, seq: 1 })).reason || 'sent'; } catch (e) { console.error('campaign link email failed', id, e.message); }

  return { propertyId: id, duplicate: false, role, managedByUid, testCampaign: isTest, charge: isTest ? 'test-campaign' : (charge?.reason || (charge?.created ? 'recorded' : null)), notification };
}

/**
 * Editing details/photos: the owner, the managing BSO, or an office admin for a campaign that has an assigned manager
 * (office-managed). An agent's own campaign stays read-only to the office, exactly as before, unless the office admin
 * deliberately assigns it a manager.
 */
function assertMayEdit(role, property) {
  if (role === 'officeAdmin' && !property.managedByUid) {
    throw new ManagedCampaignError("This is the agent's own campaign, so only the agent can edit it. Assign a manager first if the office should run it.", 403);
  }
}

async function loadCampaignFor(db, { actorUid, propertyId, allow }) {
  if (typeof propertyId !== 'string' || !propertyId) throw new ManagedCampaignError('Campaign not found', 404);
  const ref = db.collection('properties').doc(propertyId);
  const snap = await ref.get();
  if (!snap.exists) throw new ManagedCampaignError('Campaign not found', 404);
  const property = snap.data();
  const owner = await loadUser(db, property.userId);
  const role = await resolveCampaignRole(db, { actorUid, property, owner });
  if (!role) throw new ManagedCampaignError('Campaign not found', 404);
  if (allow && !allow.includes(role)) throw new ManagedCampaignError('You do not have permission to do that.', 403);
  return { ref, property, owner, role };
}

/** The caller's authority over one campaign (the edit page uses it to decide owner vs manager mode). */
export async function getCampaignRole(db, { actorUid, propertyId }) {
  const { role, property } = await loadCampaignFor(db, { actorUid, propertyId });
  let canEdit = true;
  try { assertMayEdit(role, property); } catch { canEdit = false; }
  return { propertyId, role, managedByUid: property.managedByUid || null, canEdit };
}

/**
 * Manage an existing campaign: show/hide the buyer link and archive. Owner, office admin or the managing BSO.
 * Ownership, price, details and billing are never changed here.
 */
export async function updateManagedProperty(db, { actorUid, propertyId, action }) {
  if (!['show', 'hide', 'archive'].includes(action)) throw new ManagedCampaignError('Unknown action');
  const { ref, property, owner, role } = await loadCampaignFor(db, { actorUid, propertyId });
  const patch = action === 'show' ? { visibility: true }
    : action === 'hide' ? { visibility: false }
      : { archived: true, visibility: false };
  await ref.update(patch);
  await audit(db, { action: `campaign.${action}`, propertyId, ownerUid: property.userId, actorUid, actorRole: role, officeId: owner?.officeId || null });
  return { propertyId, role, ...patch };
}

/**
 * Office admin hands a campaign's management to one of the office's BSOs (or to an office admin, e.g. themself).
 * Only `managedByUid` changes: the selling agent, the original creator and billing stay exactly as they were. The previous
 * manager loses access immediately unless another role (e.g. ownership of a legacy campaign) still applies.
 */
export async function reassignManager(db, { actorUid, propertyId, managerUid }) {
  const { ref, property, owner } = await loadCampaignFor(db, { actorUid, propertyId, allow: ['officeAdmin'] });
  if (typeof managerUid !== 'string' || !managerUid) throw new ManagedCampaignError('Choose who should manage this campaign.');
  const office = await loadActiveOffice(db, owner.officeId);
  let ok = false;
  if (adminUidsOf(office).includes(managerUid)) ok = (await loadUser(db, managerUid))?.officeId === owner.officeId;
  else ok = await isActiveBso(db, { uid: managerUid, officeId: owner.officeId, office });
  if (!ok) throw new ManagedCampaignError('Choose a BSO or an office administrator from this office.');
  const previous = property.managedByUid || null;
  if (previous === managerUid) return { propertyId, managedByUid: managerUid, changed: false };
  await ref.update({ managedByUid: managerUid });
  await audit(db, {
    action: 'campaign.reassignManager', propertyId, ownerUid: property.userId, actorUid, actorRole: 'officeAdmin',
    officeId: owner.officeId, fromUid: previous, toUid: managerUid,
  });
  return { propertyId, managedByUid: managerUid, changed: true };
}

/**
 * Edit a campaign's details through the server (the managing BSO and office admins cannot write the property directly:
 * firestore.rules keep client writes owner-only). Same allowlist as creation, plus the sales timeline, so ownership,
 * management, billing, terms and visibility can never be changed here. A status the editor cannot choose (e.g. sold)
 * is kept when the form sends it back unchanged.
 */
export async function updateManagedDetails(db, { actorUid, propertyId, input }) {
  const { ref, property, owner, role } = await loadCampaignFor(db, { actorUid, propertyId });
  assertMayEdit(role, property);
  const fields = sanitizePropertyInput(input);
  const patch = {
    ...fields,
    heroFocalPoint: fields.heroFocalPoint || null,
    listingStatus: input.listingStatus && input.listingStatus === property.listingStatus ? property.listingStatus : fields.listingStatus,
    ...([0, 1, 2].includes(input.isEager) ? { isEager: input.isEager } : {}),
    updatedAt: FieldValue.serverTimestamp(),
  };
  await ref.update(patch);
  try { await db.collection('draftProperties').doc(propertyId).set({ ...patch, override: true }, { merge: true }); } catch (e) { console.error('draftProperties write failed', propertyId, e.message); }
  await audit(db, { action: 'campaign.edit', propertyId, ownerUid: property.userId, actorUid, actorRole: role, officeId: owner?.officeId || null });
  return { propertyId, role };
}

/**
 * Attach photos (already uploaded through /api/upload-image) to a campaign. Idempotent: a URL already on the campaign is
 * never added twice, so a resumed upload job can safely repeat this call.
 */
export async function attachManagedMedia(db, { actorUid, propertyId, urls }) {
  if (!Array.isArray(urls) || urls.length === 0 || urls.length > MAX_IMAGES || !urls.every(isHttpsImage)) {
    throw new ManagedCampaignError('Photos must be https image links');
  }
  const { ref, property, owner, role } = await loadCampaignFor(db, { actorUid, propertyId });
  assertMayEdit(role, property);
  const existing = Array.isArray(property.imageUrls) ? property.imageUrls : [];
  const added = [...new Set(urls)].filter((u) => !existing.includes(u));
  const imageUrls = [...existing, ...added];
  if (imageUrls.length > MAX_IMAGES) throw new ManagedCampaignError('Too many photos');
  if (added.length === 0) return { propertyId, added: 0 };
  const patch = {
    imageUrls, imagesCompressed: false,
    imageUploadProgress: { uploaded: imageUrls.length, total: imageUrls.length, inProgress: false, interrupted: false },
  };
  await ref.update(patch);
  try { await db.collection('draftProperties').doc(propertyId).set({ imageUrls }, { merge: true }); } catch (e) { console.error('draftProperties write failed', propertyId, e.message); }
  await audit(db, { action: 'campaign.addPhotos', propertyId, ownerUid: property.userId, actorUid, actorRole: role, officeId: owner?.officeId || null, count: added.length });
  return { propertyId, added: added.length };
}

/* ───────────────────────── campaign lists (no buyer data) ───────────────────────── */

const toIso = (t) => (t?.toDate ? t.toDate().toISOString() : t || null);
const chunk = (arr, n) => Array.from({ length: Math.ceil(arr.length / n) }, (_, i) => arr.slice(i * n, i * n + n));

/** sold > archived > live (link visible) > hidden, mirroring the dashboard's own badges. */
export function campaignStatus(p) {
  if (p.archivedReason === 'sold' || p.listingStatus === 'sold' || p.sold === true) return 'sold';
  if (p.archived === true) return 'archived';
  if (p.visibility === true) return 'live';
  return 'hidden';
}

/**
 * The selling agent a campaign presents, by the same rules as the buyer page (utils/listingAgent.js +
 * publicProfileService.getAssignedAgentProfile): a listing with a roster-assigned agent (`agentId`, the older
 * "uploaded under my account for someone else" shape) is the UNIQUE office agent with exactly that name, or just the
 * roster name when there is no unique match; otherwise it is the owner.
 */
export function sellingAgentOf(p, users, profiles) {
  if (p.agentId) {
    const want = norm(p.agentName);
    const matches = want ? [...users].filter(([, u]) => isAgentUser(u) && norm(displayName(u)) === want) : [];
    if (matches.length === 1) return { ...personView(matches[0][0], matches[0][1], profiles), key: matches[0][0] };
    return { uid: null, key: `roster:${p.agentId}`, name: real(p.agentName), photoUrl: null, loginStatus: null };
  }
  return { ...personView(p.userId, users.get(p.userId), profiles), key: p.userId };
}

/** The managing user: `managedByUid`, or for an older campaign uploaded under one account for a DIFFERENT agent, that account. */
export function managerUidOf(p, sellingAgent) {
  if (p.managedByUid) return p.managedByUid;
  return sellingAgent && sellingAgent.uid !== p.userId ? p.userId : null;
}

/** Campaign summary for lists: address, selling agent, manager, creator, status. Never offers, opinions or buyers. */
export function toCampaignSummary(id, p, users, profiles, testIds = null) {
  const owner = users.get(p.userId);
  const sellingAgent = sellingAgentOf(p, users, profiles);
  const managedByUid = managerUidOf(p, sellingAgent);
  const nameOf = (uid) => (uid ? personView(uid, users.get(uid), profiles).name : null);
  return {
    id,
    // The existing app keeps the full street address in formattedAddress; `address` is suburb-level.
    address: p.formattedAddress || p.address || null,
    imageUrl: Array.isArray(p.imageUrls) && p.imageUrls[0] ? p.imageUrls[0] : null,
    ownerUid: p.userId,
    ownerName: nameOf(p.userId),
    ownerEmail: owner?.email || null,
    ownerLoginStatus: owner?.accountStatus === 'invited' ? 'invited' : 'active',
    sellingAgent,
    managedByUid,
    managedByName: nameOf(managedByUid),
    // An explicitly assigned manager (not inferred from an older own-account upload): office admins may edit these.
    officeManaged: !!p.managedByUid,
    managed: p.managedCreation === true,
    // From the server-only billing record (loadTestCampaignIds), never from the campaign's own editable fields.
    testCampaign: !!testIds?.has(id),
    createdByUid: p.createdByUid || null,
    createdByRole: p.createdByRole || null,
    createdByName: nameOf(p.createdByUid || p.userId),
    visibility: p.visibility === true,
    archived: p.archived === true,
    sold: campaignStatus(p) === 'sold',
    status: campaignStatus(p),
    createdAt: toIso(p.createdAt),
  };
}

const byNewest = (a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || ''));

/** Every non-hidden campaign owned by someone currently in the office, with who manages it. Caller has verified office admin. */
export async function listOfficeCampaigns(db, officeId) {
  const [usersSnap, profiles, office] = await Promise.all([
    db.collection('users').where('officeId', '==', officeId).get(),
    loadOfficeProfiles(db, officeId),
    loadActiveOffice(db, officeId),
  ]);
  const testIds = await loadTestCampaignIds(db);
  const users = new Map(usersSnap.docs.map((d) => [d.id, d.data()]));
  const bsos = new Set(bsoUidsOf(office).filter((uid) => isUsableAccount(users.get(uid))));
  const admins = new Set(adminUidsOf(office).filter((uid) => users.has(uid)));
  const campaigns = [];
  for (const ids of chunk([...users.keys()], 10)) {
    const snap = await db.collection('properties').where('userId', 'in', ids).get();
    for (const d of snap.docs) {
      const p = d.data();
      if (p.hidden === true) continue;
      const c = toCampaignSummary(d.id, p, users, profiles, testIds);
      // An assigned manager who is no longer a BSO or office admin here has lost access: flag it for reassignment.
      c.needsManager = !!p.managedByUid && !bsos.has(p.managedByUid) && !admins.has(p.managedByUid) && !c.archived;
      campaigns.push(c);
    }
  }
  const managers = [...new Set([...bsos, ...admins])]
    .map((uid) => ({ uid, name: personView(uid, users.get(uid), profiles).name || users.get(uid)?.email || 'Unnamed', role: bsos.has(uid) ? 'bso' : 'officeAdmin' }))
    .sort((a, b) => a.name.localeCompare(b.name));
  return { campaigns: campaigns.sort(byNewest), managers };
}

/**
 * A BSO's own portfolio: the campaigns they are assigned to manage (whose selling agent is still in their office), plus
 * campaigns they own (e.g. older campaigns uploaded under their own account for another agent). Nothing else: not other
 * BSOs' campaigns, not other campaigns of the same agents, not team campaigns.
 */
export async function listBsoCampaigns(db, actorUid) {
  const access = await getBsoAccess(db, actorUid);
  if (!access.bso) throw new ManagedCampaignError('Only BSOs can open this workspace.', 403);
  const [managedSnap, ownSnap, usersSnap, profiles] = await Promise.all([
    db.collection('properties').where('managedByUid', '==', actorUid).get(),
    db.collection('properties').where('userId', '==', actorUid).get(),
    db.collection('users').where('officeId', '==', access.officeId).get(),
    loadOfficeProfiles(db, access.officeId),
  ]);
  const testIds = await loadTestCampaignIds(db);
  const users = new Map(usersSnap.docs.map((d) => [d.id, d.data()]));
  const out = new Map();
  for (const d of managedSnap.docs) {
    const p = d.data();
    // Same live rule as resolveCampaignRole: the selling agent must still be in the BSO's office.
    if (p.hidden === true || !users.has(p.userId)) continue;
    out.set(d.id, { ...toCampaignSummary(d.id, p, users, profiles, testIds), access: p.userId === actorUid ? 'owner' : 'bso', views: viewsOf(p) });
  }
  for (const d of ownSnap.docs) {
    if (d.data().hidden === true || out.has(d.id)) continue;
    out.set(d.id, { ...toCampaignSummary(d.id, d.data(), users, profiles, testIds), access: 'owner', views: viewsOf(d.data()) });
  }
  // Counts only (never the opinions themselves), for the BSO dashboard's figures. The BSO already has report access to
  // every campaign listed here.
  const opinions = await countOpinions(db, [...out.keys()]);
  for (const [id, c] of out) c.opinions = opinions.get(id) || 0;
  return { office: { id: access.officeId, name: access.officeName }, campaigns: [...out.values()].sort(byNewest) };
}

const viewsOf = (p) => (Number.isFinite(Number(p.stats?.views)) ? Number(p.stats.views) : 0);

/** Buyer opinions per campaign: the same rule as the agent dashboard (offers of type 'opinion'). */
async function countOpinions(db, propertyIds) {
  const counts = new Map();
  for (const ids of chunk(propertyIds, 10)) {
    const snap = await db.collection('offers').where('propertyId', 'in', ids).get();
    for (const d of snap.docs) {
      const o = d.data();
      if (o.type === 'opinion') counts.set(o.propertyId, (counts.get(o.propertyId) || 0) + 1);
    }
  }
  return counts;
}

/**
 * Resend the campaign link to the selling agent. Allowed for the owner, an office admin of their office, or the
 * campaign's managing BSO (live check). A resend is a NEW once-only event (seq + 1) and is rate-limited, so it can be
 * repeated deliberately but never by accident. The recipient is always the owner's account email on file.
 */
const RESEND_COOLDOWN_MS = 60 * 1000;
export async function resendCampaignLink(db, { actorUid, propertyId }) {
  const { ref, property, owner, role } = await loadCampaignFor(db, { actorUid, propertyId });
  if (!owner) throw new ManagedCampaignError('Campaign not found', 404);
  const last = Number(property.campaignLinkResentAtMs || 0);
  if (Date.now() - last < RESEND_COOLDOWN_MS) throw new ManagedCampaignError('The link was just sent. Please wait a minute before sending it again.', 429, 'cooldown');
  const seq = Math.max(1, Number(property.campaignLinkSeq || 1)) + 1;
  await ref.update({ campaignLinkSeq: seq, campaignLinkResentAtMs: Date.now() });
  const result = await sendCampaignLinkOnce({ propertyId, recipientUid: owner.uid, seq });
  await audit(db, {
    action: 'campaign.resendLink', propertyId, ownerUid: owner.uid, actorUid, actorRole: role,
    officeId: owner.officeId || null, result: result.reason || (result.sent ? 'sent' : 'not-sent'),
  });
  return { propertyId, sent: result.sent === true, reason: result.sent ? null : result.reason };
}
