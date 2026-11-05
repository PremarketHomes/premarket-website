/**
 * Pure planning for the STAGING seed. It builds a small, entirely fake office and refuses to run against the live
 * project. No HPH data is read or copied; every name, address and buyer here is invented.
 */
const LIVE_PROJECT_ID = 'premarket-homes';

function assertStagingTarget({ projectId, serviceAccountProjectId, env = {} }) {
  if (!projectId) throw new Error('Set --project <staging project id>');
  if (projectId === LIVE_PROJECT_ID) throw new Error('Refusing: that is the LIVE project');
  if (serviceAccountProjectId && serviceAccountProjectId !== projectId) throw new Error(`Refusing: credentials are for "${serviceAccountProjectId}", not "${projectId}"`);
  for (const name of ['GOOGLE_CLOUD_PROJECT', 'GCLOUD_PROJECT', 'GCP_PROJECT', 'FIREBASE_PROJECT_ID']) {
    if (env[name] && env[name] !== projectId) throw new Error(`Refusing: ${name} is "${env[name]}", not "${projectId}"`);
  }
  if (/premarket-homes/.test(String(env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || '')) ) throw new Error('Refusing: NEXT_PUBLIC_FIREBASE_PROJECT_ID points at the live project');
  return true;
}

/** qa@premarket.homes + "office-admin" -> qa+office-admin@premarket.homes (all mail lands in one test mailbox). */
function plusAddress(qaEmail, tag) {
  const m = String(qaEmail || '').trim().toLowerCase().match(/^([^@+\s]+)@([^@\s]+\.[^@\s]+)$/);
  if (!m) throw new Error('--qa-email must be a plain address like qa@yourdomain.com');
  return `${m[1]}+${tag}@${m[2]}`;
}

function buildSeedPlan({ qaEmail }) {
  const e = (tag) => plusAddress(qaEmail, tag);
  const person = (uid, first, last, tag, extra = {}) => ({ uid, email: e(tag), firstName: first, lastName: last, ...extra });
  const users = [
    person('stg_admin', 'Olive', 'Office-Admin', 'office-admin', { isOfficeAdmin: true, accountStatus: 'active' }),
    person('stg_teamlead', 'Tara', 'Team-Creator', 'team-creator', { accountStatus: 'active', teamId: 'stg_team1' }),
    person('stg_member', 'Max', 'Member', 'member', { accountStatus: 'active', teamId: 'stg_team1' }),
    person('stg_invited', 'Ivy', 'Invited-Never-Logged-In', 'invited', { accountStatus: 'invited', teamId: 'stg_team1' }),
    person('stg_plain', 'Pat', 'Plain-Agent', 'plain-agent', { accountStatus: 'active' }),
    person('stg_leader', 'Lee', 'Leadership', 'leadership', { accountStatus: 'active' }),
  ].map((u) => ({ ...u, agent: true, pro: true, active: true, roles: ['agent'], officeId: 'stg_office' }));
  return {
    office: { id: 'stg_office', info: { name: 'Staging Realty (test data)', officeAdminUids: ['stg_admin'], leadershipUids: ['stg_leader'], status: 'active', retailCampaignPrice: 395, createdBy: 'stg_admin' }, public: { agencyBrandId: null } },
    users,
    teams: [{ id: 'stg_team1', officeId: 'stg_office', createdBy: 'stg_teamlead', name: 'Staging Team One' }],
    settings: {
      invoicing: { pricePerListing: 200, gstRate: 0, billingActivatedAt: 'NOW', excludeAgentIds: [], cronEnabled: false },
      addPropertyTermsAgent: { body: '1. Introduction\nThese are STAGING test terms.\n\n2. The service\nTest only.\n\n6. Payment Terms\nPlaceholder payment terms.\n\n7. General\nTest only.\n' },
    },
    // One fake campaign with one fake registration, so Registrations / reports can be exercised.
    properties: [{ id: 'stg_prop_1', userId: 'stg_member', address: 'Test Suburb NSW Australia', formattedAddress: '1 Test Street, Test Suburb NSW 2000, Australia', title: 'Staging test home', price: '900000', visibility: true, active: true, imageUrls: [] }],
    offers: [{ id: 'stg_offer_1', propertyId: 'stg_prop_1', serious: true, buyerName: 'Fake Buyer', buyerEmail: e('fake-buyer'), buyerPhone: '0400 000 000', nextAction: 'contact', timeframe: '3-months', offerAmount: 880000 }],
  };
}

module.exports = { assertStagingTarget, buildSeedPlan, plusAddress, LIVE_PROJECT_ID };
