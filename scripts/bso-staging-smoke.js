#!/usr/bin/env node
/**
 * STAGING smoke test for the BSO Workspace (15 checks). Same safety rails as scripts/staging-smoke.js: refuses to run unless the
 * credential in ~/.premarket-staging is a staging project (never premarket-homes) and the browser config matches it. Creates its own
 * FAKE people (qa+bso-*@premarket-staging.invalid), teams and campaigns in the staging project only; no HPH data is read or copied.
 *
 *   node scripts/bso-staging-smoke.js <output-dir-for-screenshots>      env: BASE_URL (default http://localhost:3200), CHROME_PATH, FAKE_RESEND_FILE
 *
 * Run on a freshly reset + seeded staging project, after (or instead of) scripts/staging-smoke.js, against a staging app running with
 * MANAGED_CAMPAIGNS_ENABLED=1. Substitutes, as in the base smoke: Google Places (stubbed), Bunny (fake upload target), Resend
 * (payloads recorded to FAKE_RESEND_FILE by a local preload, never sent).
 */
const { chromium } = require('playwright-core');
const fs = require('fs'); const os = require('os'); const path = require('path');
const HOME = os.homedir();
const sa = require(path.join(HOME, '.premarket-staging/staging-sa.json'));
const web = require(path.join(HOME, '.premarket-staging/web-config.json'));
const PROJECT = sa.project_id; if (PROJECT === 'premarket-homes' || web.projectId !== PROJECT) throw new Error('ISOLATION: wrong project');
const BASE = process.env.BASE_URL || 'http://localhost:3200'; const OUT = process.argv[2];
const { initializeApp, cert } = require('firebase-admin/app'); const { getFirestore } = require('firebase-admin/firestore'); const { getAuth } = require('firebase-admin/auth');
const app = initializeApp({ credential: cert(sa), projectId: PROJECT }); const db = getFirestore(app); const adminAuth = getAuth(app);
const pw = {}; for (const l of fs.readFileSync(path.join(HOME, '.premarket-staging/seed-output.txt'), 'utf8').split('\n')) { const m = l.match(/^\s+(qa\+[^\s@]+@\S+)\s+(\S+)$/); if (m) pw[m[1]] = m[2]; }
const E = (tag) => `qa+${tag}@premarket-staging.invalid`;
const results = []; const log = (...a) => console.log(...a);
async function t(name, fn) { try { const note = await fn(); results.push({ name, ok: true, note: note || '' }); log('PASS', name, note ? `[${note}]` : ''); } catch (e) { results.push({ name, ok: false, note: e.message.split('\n')[0] }); log('FAIL', name, '->', e.message.split('\n')[0]); } }
const ok = (c, m) => { if (!c) throw new Error(m || 'assertion failed'); };
const token = async (email) => { const r = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${web.apiKey}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password: pw[email], returnSecureToken: true }) }); const j = await r.json(); if (!j.idToken) throw new Error('sign-in failed for ' + email + ': ' + (j.error && j.error.message)); return j.idToken; };
const api = async (email, p, method = 'GET', body) => { const r = await fetch(BASE + p, { method, headers: { authorization: 'Bearer ' + await token(email), 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }); return { status: r.status, body: await r.json().catch(() => ({})) }; };
const MAPS_STUB = (cb) => `(function(){class Autocomplete{constructor(){window.__ac=this}getPlace(){return window.__place}setBounds(){}setComponentRestrictions(){}setFields(){}setOptions(){}setTypes(){}getBounds(){}}
const ev={addListener(i,n,f){(i.__l=i.__l||{})[n]=f;return{remove(){}}},removeListener(){},clearInstanceListeners(){},trigger(){}};window.google=window.google||{};const m=(window.google.maps=window.google.maps||{});
const boot=${JSON.stringify(cb || '')}&&${JSON.stringify(cb || '')}.split('.').reduce((o,k)=>o?o[k]:undefined,window);m.places={Autocomplete};m.event=ev;m.version='3.stub';m.importLibrary=async()=>({Autocomplete});if(typeof boot==='function')boot();})();`;
const seen = { sentry: 0, firebaseUrls: [], live: 0 };
async function ctxFor(b, opts = {}) {
  const c = await b.newContext({ viewport: { width: 1280, height: 900 }, ...opts });
  await c.route(/google-analytics\.com|googletagmanager\.com/, (r) => r.abort()); // production analytics id is hardcoded in the layout: blocked in tests, reported
  await c.route(/maps\.googleapis\.com|maps\.gstatic\.com/, (r) => { const u = new URL(r.request().url()); return u.pathname.endsWith('/js') ? r.fulfill({ status: 200, contentType: 'text/javascript', body: MAPS_STUB(u.searchParams.get('callback')) }) : r.fulfill({ status: 204, body: '' }); });
  c.on('request', (r) => { const u = r.url(); if (/sentry\.io/.test(u)) seen.sentry++; if (/firebase|googleapis\.com|identitytoolkit|securetoken|firestore/i.test(u) && !/maps\./.test(u)) seen.firebaseUrls.push(u); if (/premarket-homes/i.test(u)) seen.live++; });
  const np = c.newPage.bind(c); c.newPage = async () => { const p = await np(); p.on('dialog', (d) => d.accept()); return p; };
  return c;
}
async function login(page, tag) { await page.goto(BASE + '/login', { waitUntil: 'domcontentloaded' }); await page.fill('input[type=email]', E(tag)); await page.fill('input[type=password]', pw[E(tag)]); await page.click('button[type=submit]'); await page.waitForURL(/dashboard/, { timeout: 40000 }); }
async function wizard(page, { forLabel, address, suburb, title, shot, tamper }) {
  await page.goto(BASE + '/dashboard/add');
  if (forLabel) { await page.waitForSelector('#campaign-for', { timeout: 25000 }); await page.selectOption('#campaign-for', { label: forLabel }); }
  await page.waitForSelector('input[placeholder="123 Main Street, Sydney NSW"]', { timeout: 25000 });
  await page.fill('input[placeholder="123 Main Street, Sydney NSW"]', address.slice(0, 10));
  await page.evaluate(([a, s]) => { window.__place = { formatted_address: a, geometry: { location: { lat: () => -28.2623, lng: () => 153.5703 } }, address_components: [{ types: ['locality'], long_name: s }, { types: ['administrative_area_level_1'], short_name: 'NSW' }, { types: ['country'], long_name: 'Australia' }] }; window.__ac.__l.place_changed(); }, [address, suburb]);
  const next = async () => { await page.click('button:has-text("Continue")'); await page.waitForTimeout(350); };
  await next(); await page.click('button:has-text("House")'); await next();
  await page.fill('input[placeholder="750,000"]', '1,250,000'); await next();
  await page.fill('input[placeholder="3"]', '4'); await page.locator('input[placeholder="2"]').nth(0).fill('2'); await page.locator('input[placeholder="2"]').nth(1).fill('2'); await next();
  await page.setInputFiles('input[type=file]', path.join(OUT, 'tiny.png')); await page.waitForTimeout(800); await next();
  await page.fill('input[placeholder="Beautiful family home in..."]', title); await next();
  await page.waitForSelector('text=Terms & Conditions'); await page.waitForTimeout(1800);
  if (shot) await page.screenshot({ path: path.join(OUT, shot), fullPage: true });
  await page.check('input[type=checkbox]');
  if (tamper) await page.route('**/api/properties/managed', async (route) => { const b = JSON.parse(route.request().postData() || '{}'); b.ownerUid = tamper; await route.continue({ postData: JSON.stringify(b) }); });
  await page.click('button:has-text("Submit Property")');
}
const RESEND_FILE = process.env.FAKE_RESEND_FILE || '/tmp/fake-resend.jsonl';
const resend = () => (fs.existsSync(RESEND_FILE) ? fs.readFileSync(RESEND_FILE, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);

/* ───────────────────────── BSO fixtures (fake people only, staging only) ───────────────────────── */
const OFFICE = 'stg_office';
const P = (tag) => E(`bso-${tag}`);
const FIX = [
  ['stg_bso_penny', 'Penny', 'Bso-Manager', 'penny', {}],
  ['stg_bso_bella', 'Bella', 'Bso-Second', 'bella', {}],
  ['stg_bso_chloe', 'Chloe', 'Seller-TeamA', 'chloe', { teamId: 'stg_bso_teamA' }],
  ['stg_bso_tim', 'Tim', 'Teammate-TeamA', 'tim', { teamId: 'stg_bso_teamA' }],
  ['stg_bso_brett', 'Brett', 'Seller-TeamB', 'brett', { teamId: 'stg_bso_teamB' }],
  ['stg_bso_bree', 'Bree', 'Teammate-TeamB', 'bree', { teamId: 'stg_bso_teamB' }],
  ['stg_bso_ivan', 'Ivan', 'Independent-Seller', 'ivan', {}],
  ['stg_bso_iris', 'Iris', 'Invited-Seller', 'iris', { accountStatus: 'invited' }],
];
const NAME = Object.fromEntries(FIX.map(([uid, f, l]) => [uid, `${f} ${l}`]));
const EMAIL = Object.fromEntries(FIX.map(([uid, , , tag]) => [uid, P(tag)]));
async function seedBso() {
  const { randomBytes } = require('crypto');
  for (const [uid, firstName, lastName, tag, extra] of FIX) {
    const password = randomBytes(12).toString('base64url');
    try { await adminAuth.deleteUser(uid); } catch { /* not there */ }
    await adminAuth.createUser({ uid, email: P(tag), password, emailVerified: true, displayName: `${firstName} ${lastName}` });
    pw[P(tag)] = password;
    await db.collection('users').doc(uid).set({ firstName, lastName, email: P(tag), agent: true, pro: true, active: true, roles: ['agent'], officeId: OFFICE, accountStatus: 'active', ...extra });
  }
  await db.collection('teams').doc('stg_bso_teamA').set({ officeId: OFFICE, createdBy: 'stg_bso_chloe', name: 'Sales Team A', createdAt: new Date() });
  await db.collection('teams').doc('stg_bso_teamB').set({ officeId: OFFICE, createdBy: 'stg_bso_brett', name: 'Sales Team B', createdAt: new Date() });
  // The older shape (like 73 Riverwalk): uploaded under the BSO's own account, with the selling agent picked from her personal roster.
  await db.collection('agents').doc('stg_bso_roster1').set({ userId: 'stg_bso_penny', name: NAME.stg_bso_chloe });
  await db.collection('properties').doc('stg_bso_legacy').set({ userId: 'stg_bso_penny', agentId: 'stg_bso_roster1', agentName: NAME.stg_bso_chloe, agentAvatar: null, formattedAddress: '73 Legacy Walk, Robina QLD 4226, Australia', address: 'Robina QLD Australia', title: 'Legacy shape campaign', price: '1000000', bedrooms: 3, bathrooms: 2, carSpaces: 1, imageUrls: [], visibility: false, active: true, vendorUploaded: true, agent: true, createdAt: new Date() });
}
async function loginAs(page, email) {
  await page.goto(BASE + '/login', { waitUntil: 'domcontentloaded' }); await page.fill('input[type=email]', email); await page.fill('input[type=password]', pw[email]);
  await page.click('button[type=submit]'); await page.waitForURL(/dashboard/, { timeout: 40000 });
}
const byAddress = async (a) => (await db.collection('properties').where('formattedAddress', '==', a).get()).docs;
const linkEmails = () => resend().map((x) => x.body).filter((x) => /campaign link/i.test(x.subject || ''));
const createApi = (email, ownerUid, address, requestId) => api(email, '/api/properties/managed', 'POST', { ownerUid, requestId, acceptTerms: true, property: { address: 'Robina QLD Australia', formattedAddress: address, price: '$950,000', bedrooms: 3, bathrooms: 2, carSpaces: 1, propertyType: 1, imageUrls: [] } });
const ids = {};

(async () => {
  fs.writeFileSync(path.join(OUT, 'tiny.png'), Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64'));
  fs.writeFileSync(path.join(OUT, 'tiny2.png'), Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAEklEQVR42mP8z8DwnwEJMIIBABOjAf/OqOx4AAAAAElFTkSuQmCC', 'base64'));
  await seedBso();
  const emailsAtStart = linkEmails().length;
  const b = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
  const errors = [];
  const page = async () => { const p = await (await ctxFor(b)).newPage(); p.on('pageerror', (e) => errors.push(e.message)); return p; };

  // ───────── 1. Office admin assigns the BSO role
  const admin = await page(); await login(admin, 'office-admin');
  await t('B1 office admin makes Penny a BSO from Office > Agents; badge shown; stored server-side only; audited', async () => {
    await admin.goto(BASE + '/dashboard/office/agents'); await admin.waitForSelector(`li:has-text("${NAME.stg_bso_penny}")`, { timeout: 30000 });
    await admin.click(`button[aria-label="More actions for ${NAME.stg_bso_penny}"]`); await admin.click('button[role=menuitem]:has-text("Make BSO")');
    await admin.waitForSelector('text=is now a BSO', { timeout: 15000 });
    ok(await admin.locator(`li:has-text("${NAME.stg_bso_penny}") >> text=BSO`).count() > 0, 'badge');
    const info = (await db.collection('officeAdminInfo').doc(OFFICE).get()).data(); ok((info.bsoUids || []).includes('stg_bso_penny'), 'bsoUids');
    const u = (await db.collection('users').doc('stg_bso_penny').get()).data(); ok(!('isBso' in u) && !('bso' in u), 'role leaked onto user doc');
    const audit = (await db.collection('officeTeamAudit').where('action', '==', 'office.bsoGranted').get()).docs.map((d) => d.data().targetUid); ok(audit.includes('stg_bso_penny'), 'audit');
    const g = await api(E('office-admin'), `/api/offices/${OFFICE}/bsos`, 'POST', { uid: 'stg_bso_bella' }); ok(g.status === 200 && g.body.bso === true, 'grant Bella');
    for (const who of [E('team-creator'), P('chloe'), P('penny')]) ok((await api(who, `/api/offices/${OFFICE}/bsos`, 'POST', { uid: 'stg_bso_ivan' })).status === 403, 'non-admin granted');
    await admin.screenshot({ path: path.join(OUT, 'b1-agents-bso.png'), fullPage: true });
    return 'Penny (UI) and Bella (API) are BSOs; 3 other roles refused';
  });

  // ───────── 2. BSO navigation
  const penny = await page(); await loginAs(penny, P('penny'));
  await t('B2 Penny sees "My Campaigns"; the former team admin and agents are not BSOs', async () => {
    await penny.goto(BASE + '/dashboard'); await penny.waitForSelector('text=My Campaigns', { timeout: 30000 });
    for (const who of [E('team-creator'), P('chloe'), E('office-admin')]) ok((await api(who, '/api/bso/access')).body.bso === false, who);
    ok((await api(P('penny'), '/api/bso/access')).body.bso === true, 'penny');
  });

  // ───────── 3. Creation (UI wizard + background photo upload, then API)
  await t('B3 Penny creates a campaign for Chloe (Sales Team A) in the wizard; photos upload in the background; lands in My Campaigns', async () => {
    await wizard(penny, { forLabel: NAME.stg_bso_chloe, address: '14 Riverside Walk, Robina QLD 4226, Australia', suburb: 'Robina', title: 'BSO staging home', shot: 'b3-terms.png' });
    await penny.waitForURL(/dashboard\/bso\?created=1/, { timeout: 60000 }); await penny.waitForSelector('li:has-text("14 Riverside Walk")', { timeout: 30000 });
    const d = await byAddress('14 Riverside Walk, Robina QLD 4226, Australia'); ok(d.length === 1, 'count ' + d.length); const p = d[0].data(); ids.riverside = d[0].id;
    ok(p.userId === 'stg_bso_chloe' && p.managedByUid === 'stg_bso_penny' && p.createdByUid === 'stg_bso_penny' && p.createdByRole === 'bso' && p.agentId === null && p.vendorUploaded === false, JSON.stringify({ u: p.userId, m: p.managedByUid, c: p.createdByUid, r: p.createdByRole }));
    ok(Array.isArray(p.imageUrls) && p.imageUrls.length === 1, 'photos ' + (p.imageUrls || []).length);
    await penny.screenshot({ path: path.join(OUT, 'b3-my-campaigns.png'), fullPage: true });
    return 'owner=Chloe managedBy=Penny createdBy=Penny (bso), 1 photo';
  });
  await t('B4 Penny creates for Brett (Sales Team B), Ivan (independent) and Iris (never logged in); Bella creates one for Chloe', async () => {
    for (const [owner, addr, key] of [['stg_bso_brett', '2 Brett Street, Robina QLD 4226, Australia', 'brett'], ['stg_bso_ivan', '3 Ivan Street, Robina QLD 4226, Australia', 'ivan'], ['stg_bso_iris', '4 Iris Street, Robina QLD 4226, Australia', 'iris']]) {
      const r = await createApi(P('penny'), owner, addr, `bso-smoke-${key}-000000001`); ok(r.status === 201, key + ' ' + r.status + JSON.stringify(r.body)); ids[key] = r.body.propertyId;
    }
    const r = await createApi(P('bella'), 'stg_bso_chloe', '5 Bella Street, Robina QLD 4226, Australia', 'bso-smoke-bella-00000001'); ok(r.status === 201, 'bella ' + r.status); ids.bella = r.body.propertyId;
    const f = await createApi(E('team-creator'), 'stg_member', '6 Forged Street, Robina QLD 4226, Australia', 'bso-smoke-forged-0000001'); ok(f.status === 404, 'former team admin created ' + f.status);
    const g = await createApi(P('penny'), 'stg_member', '7 Hand-off Street, Robina QLD 4226, Australia', 'bso-smoke-handoff-000001'); ok(g.status === 201, 'penny for a team-one member');
    ids.member = g.body.propertyId;
    return '5 created by Penny, 1 by Bella; former team admin refused';
  });

  // ───────── 4. Dashboard filtering
  await t('B5 My Campaigns lists only Penny\'s campaigns (plus her older own-account one) and filters by selling agent', async () => {
    await penny.goto(BASE + '/dashboard/bso'); await penny.waitForSelector('[data-testid=bso-campaign]', { timeout: 30000 });
    const rows = await penny.locator('[data-testid=bso-campaign]').allInnerTexts(); ok(rows.length === 6, 'rows ' + rows.length + ' ' + rows.map((r) => r.split('\n')[0]).join(' | '));
    ok(!rows.some((r) => /Bella Street/.test(r)), "Bella's campaign shown");
    const opts = await penny.locator('#agent-filter option').allTextContents();
    ok(opts[0] === 'All Agents' && opts.some((o) => o.startsWith(NAME.stg_bso_chloe + ' (2)')) && opts.some((o) => o.startsWith(NAME.stg_bso_brett)) && opts.some((o) => o.startsWith(NAME.stg_bso_iris)), 'options ' + opts.join('|'));
    await penny.selectOption('#agent-filter', { label: `${NAME.stg_bso_chloe} (2)` });
    const chloe = await penny.locator('[data-testid=bso-campaign]').allInnerTexts(); ok(chloe.length === 2 && chloe.some((r) => /Riverside/.test(r)) && chloe.some((r) => /Legacy Walk/.test(r)), 'chloe filter ' + chloe.length);
    await penny.screenshot({ path: path.join(OUT, 'b5-filter-chloe.png'), fullPage: true });
    await penny.selectOption('#agent-filter', { label: 'All Agents' }); ok((await penny.locator('[data-testid=bso-campaign]').count()) === 6, 'all');
    ok(rows.some((r) => /Iris Invited-Seller[\s\S]*not logged in yet/.test(r)), 'invited label');
    return opts.join(' | ');
  });

  // ───────── 5. Restrictions between BSOs, teams and roles (server-side)
  await t('B6 Penny cannot see or touch Bella\'s campaign (same selling agent); the former team admin cannot touch Penny\'s', async () => {
    const tries = (who, id) => Promise.all([
      api(who, `/api/properties/${id}/managed`), api(who, `/api/properties/${id}/managed`, 'PATCH', { action: 'show' }),
      api(who, `/api/properties/${id}/managed/details`, 'PUT', { property: { address: 'x', price: '1' } }), api(who, `/api/properties/${id}/managed/media`, 'POST', { urls: ['https://example.invalid/a.jpg'] }),
      api(who, `/api/properties/${id}/campaign-link/resend`, 'POST'), api(who, `/api/properties/${id}/report`),
    ]);
    for (const [who, id] of [[P('penny'), ids.bella], [E('team-creator'), ids.riverside], [E('member'), ids.riverside], [P('bella'), ids.riverside]]) {
      const s = (await tries(who, id)).map((r) => r.status); ok(s.slice(0, 5).every((x) => x === 404) && s[5] === 403, who + ' ' + s.join(','));
    }
    ok((await db.collection('properties').doc(ids.bella).get()).data().visibility === false, 'changed');
    const bella = await api(P('bella'), '/api/bso/campaigns'); ok(bella.body.campaigns.map((c) => c.id).join() === ids.bella, 'bella list');
    ok((await api(E('team-creator'), '/api/bso/campaigns')).status === 403, 'former team admin got a BSO list');
    return 'all 6 routes refused in 4 combinations';
  });
  await t('B7 teammate view stays redacted and follows formal teams only: Team A sees Chloe\'s, not Brett\'s; Team B the reverse', async () => {
    const tim = await api(P('tim'), `/api/properties/${ids.riverside}/report`); ok(tim.status === 200 && tim.body.access === 'teamMember' && tim.body.redacted === true && JSON.stringify(tim.body.buyers) === '{}', 'tim ' + tim.status);
    ok((await api(P('tim'), `/api/properties/${ids.brett}/report`)).status === 403, 'tim sees Brett');
    ok((await api(P('tim'), `/api/properties/${ids.ivan}/report`)).status === 403, 'tim sees Ivan');
    ok((await api(P('bree'), `/api/properties/${ids.riverside}/report`)).status === 403, 'bree sees Chloe');
    ok((await api(P('bree'), `/api/properties/${ids.brett}/report`)).body.access === 'teamMember', 'bree on Brett');
    return 'Team A↔Chloe, Team B↔Brett only';
  });

  // ───────── 6. Office admin oversight + reassignment
  await t('B8 office admin sees every campaign with selling agent and manager, filters by BSO, and hands one to Bella', async () => {
    const list = await api(E('office-admin'), `/api/offices/${OFFICE}/campaigns`); ok(list.status === 200, 'list');
    const by = Object.fromEntries(list.body.campaigns.map((c) => [c.id, c]));
    ok(by[ids.riverside].managedByName === NAME.stg_bso_penny && by[ids.riverside].sellingAgent.name === NAME.stg_bso_chloe, 'riverside row');
    ok(by.stg_bso_legacy.managedByUid === 'stg_bso_penny' && by.stg_bso_legacy.sellingAgent.uid === 'stg_bso_chloe', 'legacy row');
    ok(['stg_bso_penny', 'stg_bso_bella', 'stg_admin'].every((u) => list.body.managers.some((m) => m.uid === u)), 'managers');
    await admin.goto(BASE + '/dashboard/office/campaigns'); await admin.waitForSelector('li:has-text("2 Brett Street")', { timeout: 30000 });
    await admin.selectOption('select[aria-label="Filter by BSO"]', { label: NAME.stg_bso_penny });
    const rows = await admin.locator('ul li:has-text("Managed by")').count(); ok(rows === 6, 'penny filter rows ' + rows);
    await admin.selectOption('select[aria-label="Change manager of 2 Brett Street, Robina QLD 4226, Australia"]', { label: `${NAME.stg_bso_bella} (BSO)` });
    await admin.waitForSelector(`text=${NAME.stg_bso_bella} now manages`, { timeout: 15000 });
    const p = (await db.collection('properties').doc(ids.brett).get()).data(); ok(p.managedByUid === 'stg_bso_bella' && p.userId === 'stg_bso_brett' && p.createdByUid === 'stg_bso_penny', 'stored');
    ok((await api(P('penny'), `/api/properties/${ids.brett}/managed`)).status === 404, 'penny kept access');
    ok((await api(P('bella'), `/api/properties/${ids.brett}/managed`)).body.role === 'bso', 'bella no access');
    ok((await api(P('penny'), `/api/properties/${ids.brett}/managed/manager`, 'POST', { managerUid: 'stg_bso_penny' })).status === 404, 'BSO reassigned');
    await admin.screenshot({ path: path.join(OUT, 'b8-office-campaigns.png'), fullPage: true });
    return 'Brett campaign: Penny → Bella; seller and creator unchanged';
  });

  // ───────── 7. Editing + background media as the manager
  await t('B9 Penny edits Chloe\'s campaign in manager mode and adds a photo; the photo uploads in the background and is attached via the server', async () => {
    await penny.goto(BASE + `/dashboard/edit/${ids.riverside}`); await penny.waitForSelector('button:has-text("Continue")', { timeout: 30000 });
    const next = async () => { await penny.click('button:has-text("Continue")'); await penny.waitForTimeout(400); };
    await next(); await next(); await next(); await next(); // address, type, price, details
    await penny.setInputFiles('input[type=file]', path.join(OUT, 'tiny2.png')); await penny.waitForTimeout(800); await next();
    await penny.fill('input[placeholder="Beautiful family home in..."]', 'BSO staging home (edited)');
    ok((await penny.locator('text=Assign Agent (Optional)').count()) === 0, 'roster agent selector shown to the manager');
    await next(); await penny.click('button:has-text("Very serious")'); await penny.click('button:has-text("Save Changes")');
    await penny.waitForURL(/dashboard\/bso\?updated=1/, { timeout: 30000 });
    let p; for (let i = 0; i < 40; i++) { p = (await db.collection('properties').doc(ids.riverside).get()).data(); if ((p.imageUrls || []).length === 2) break; await new Promise((r) => setTimeout(r, 500)); }
    ok(p.title === 'BSO staging home (edited)' && p.isEager === 0, 'details ' + p.title);
    ok(p.imageUrls.length === 2 && new Set(p.imageUrls).size === 2, 'photos ' + p.imageUrls.length);
    ok(p.userId === 'stg_bso_chloe' && p.managedByUid === 'stg_bso_penny', 'identity changed');
    const audit = (await db.collection('officeCampaignAudit').where('propertyId', '==', ids.riverside).get()).docs.map((d) => d.data().action); ok(audit.includes('campaign.edit') && audit.includes('campaign.addPhotos'), 'audit ' + audit);
    return '2 photos, title updated, owner/manager unchanged';
  });

  // ───────── 8. Report + registration details for the manager only
  await t('B10 Penny opens the report of her campaign (labelled BSO, read-only) with registration details; Bella cannot', async () => {
    await db.collection('offers').doc('stg_bso_reg_00000001').set({ propertyId: ids.riverside, type: 'opinion', serious: true, buyerName: 'Fake Bso Buyer', buyerEmail: P('buyer'), buyerPhone: '0400 000 009', nextAction: 'contact', timeframe: '3-months', offerAmount: 880000, createdAt: new Date() });
    await penny.goto(BASE + `/dashboard/property/${ids.riverside}`); await penny.waitForSelector("text=Viewing as the campaign's BSO", { timeout: 30000 });
    const r = await api(P('penny'), `/api/properties/${ids.riverside}/report`); ok(r.status === 200 && r.body.access === 'manager' && r.body.readOnly === true && r.body.offers.length === 1, 'report');
    ok((await api(P('bella'), `/api/properties/${ids.riverside}/report`)).status === 403, 'bella');
    ok((await api(P('penny'), '/api/registrations/managed')).status === 403, 'BSO got a registrations list');
    await penny.screenshot({ path: path.join(OUT, 'b10-report.png'), fullPage: true });
  });

  // ───────── 9. Buyer-facing branding
  await t('B11 the public buyer page shows the selling agent (Chloe), never the BSO, for new and older-shape campaigns', async () => {
    const anon = await page();
    for (const id of [ids.riverside, 'stg_bso_legacy']) {
      await anon.goto(BASE + `/find-property?propertyId=${id}`); await anon.waitForSelector(`text=${NAME.stg_bso_chloe}`, { timeout: 40000 });
      const txt = await anon.locator('body').innerText(); ok(!/Penny|Bso-Manager/.test(txt), 'BSO shown on ' + id);
    }
    await anon.screenshot({ path: path.join(OUT, 'b11-buyer-page.png'), fullPage: true });
    return 'Chloe shown on both; Penny never';
  });

  // ───────── 10. Email routing and once-only delivery
  await t('B12 exactly one campaign-link email per new campaign, to the selling agent\'s account email; none to BSOs; resend once then rate limited', async () => {
    await new Promise((r) => setTimeout(r, 1500));
    const mails = linkEmails().slice(emailsAtStart); const to = mails.map((m) => [].concat(m.to).join()).sort();
    const want = [EMAIL.stg_bso_chloe, EMAIL.stg_bso_chloe, EMAIL.stg_bso_brett, EMAIL.stg_bso_ivan, EMAIL.stg_bso_iris, E('member')].sort();
    ok(JSON.stringify(to) === JSON.stringify(want), 'recipients ' + to.join(','));
    ok(!to.some((x) => x === EMAIL.stg_bso_penny || x === EMAIL.stg_bso_bella), 'BSO emailed');
    ok(mails.every((m) => /find-property\?propertyId=m_/.test(m.html) && !/880000|0400 000 009|\$\s?950,000/.test(m.html + (m.text || ''))), 'content');
    ok(mails.some((m) => /Penny Bso-Manager at your office/.test(m.html)), 'creator named');
    const before = linkEmails().length;
    ok((await api(P('penny'), `/api/properties/${ids.riverside}/campaign-link/resend`, 'POST')).body.sent === true, 'resend');
    ok((await api(P('penny'), `/api/properties/${ids.riverside}/campaign-link/resend`, 'POST')).status === 429, 'cooldown');
    await new Promise((r) => setTimeout(r, 800)); const after = linkEmails().slice(before); ok(after.length === 1 && [].concat(after[0].to).join() === EMAIL.stg_bso_chloe, 'resend recipient');
    return `${mails.length} emails, all to selling agents (fake test addresses, captured)`;
  });

  // ───────── 11. Billing attribution and duplicate prevention
  await t('B13 one charge per BSO campaign on the office, attributed to the selling agent; a retried upload creates no campaign, charge or email', async () => {
    for (const [k, owner] of [['riverside', 'stg_bso_chloe'], ['brett', 'stg_bso_brett'], ['ivan', 'stg_bso_ivan'], ['iris', 'stg_bso_iris'], ['bella', 'stg_bso_chloe']]) {
      const c = await db.collection('propertyCharges').doc(ids[k]).get(); ok(c.exists, 'no charge ' + k); const d = c.data();
      ok(d.officeId === OFFICE && d.agentUserId === owner && d.pricePerListing === 200 && d.status === 'pending', k + ' ' + JSON.stringify({ o: d.officeId, a: d.agentUserId }));
    }
    const charges = (await db.collection('propertyCharges').get()).size; const mails = linkEmails().length; const props = (await db.collection('properties').get()).size;
    const r = await createApi(P('penny'), 'stg_bso_brett', '2 Brett Street, Robina QLD 4226, Australia', 'bso-smoke-brett-000000001');
    ok(r.status === 200 && r.body.duplicate === true && r.body.propertyId === ids.brett, 'retry ' + r.status);
    await new Promise((x) => setTimeout(x, 800));
    ok((await db.collection('propertyCharges').get()).size === charges && linkEmails().length === mails && (await db.collection('properties').get()).size === props, 'retry wrote something');
    return 'office-level billing, seller attribution, no duplicates';
  });

  // ───────── 12. Removing the role
  await t('B14 removing Bella\'s BSO role ends her access at once and flags her campaigns for reassignment', async () => {
    const r = await api(E('office-admin'), `/api/offices/${OFFICE}/bsos/stg_bso_bella`, 'DELETE'); ok(r.status === 200 && r.body.campaignsNeedingManager === 2, JSON.stringify(r.body));
    ok((await api(P('bella'), '/api/bso/access')).body.bso === false, 'access'); ok((await api(P('bella'), `/api/properties/${ids.bella}/managed`)).status === 404, 'manage');
    const list = await api(E('office-admin'), `/api/offices/${OFFICE}/campaigns`); const flagged = list.body.campaigns.filter((c) => c.needsManager).map((c) => c.id).sort();
    ok(JSON.stringify(flagged) === JSON.stringify([ids.bella, ids.brett].sort()), 'flagged ' + flagged);
    ok((await db.collection('properties').doc(ids.bella).get()).data().managedByUid === 'stg_bso_bella', 'history changed');
  });

  // ───────── 13. Isolation
  await t('B15 every browser Firebase request went to the staging project, no Sentry, no page errors', async () => {
    ok(seen.live === 0 && seen.sentry === 0, `live ${seen.live} sentry ${seen.sentry}`);
    const real = errors.filter((e) => !/Failed to load resource|ResizeObserver/.test(e)); ok(real.length === 0, real[0]);
    return `${seen.firebaseUrls.length} Firebase requests, 0 live`;
  });

  await b.close();
  const pass = results.filter((r) => r.ok).length; log(`\nRESULT: ${pass}/${results.length} passed`); results.filter((r) => !r.ok).forEach((r) => log('FAILED:', r.name, '->', r.note));
  fs.writeFileSync(path.join(OUT, 'bso-smoke-results.json'), JSON.stringify(results, null, 2));
  process.exit(0);
})().catch((e) => { console.error('SMOKE ABORTED:', e.message); process.exit(1); });
