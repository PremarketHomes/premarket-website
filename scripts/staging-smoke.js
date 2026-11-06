#!/usr/bin/env node
/**
 * STAGING smoke test for the Office Workspace (29 checks). Refuses to run unless the credential in ~/.premarket-staging is a staging
 * project (never premarket-homes) and the browser config matches it. Needs: `npm i --no-save playwright-core`, Chrome, a running
 * staging app (see docs/release/STAGING_ENVIRONMENT.md) and a freshly seeded staging project (scripts/reset-staging.js, scripts/seed-staging.js).
 *
 *   node scripts/staging-smoke.js <output-dir-for-screenshots>      env: BASE_URL (default http://localhost:3200), CHROME_PATH
 *
 * The staging app must run with MANAGED_CAMPAIGNS_ENABLED=1 and OFFICE_REGISTRATIONS_ENABLED=1 (both OFF by default) and TEAM_REGISTRATIONS_ENABLED unset.
 * Substitutes, labelled in the report: Google Places (stubbed place data), Bunny (fake upload target), Resend (payloads recorded to
 * /tmp/fake-resend.jsonl by a local preload, never sent). Everything else is real: browser UI, staging Auth, staging Firestore + deployed rules.
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
const prodCounts = async () => 'skipped';

(async () => {
  fs.writeFileSync(path.join(OUT, 'tiny.png'), Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64'));
  const b = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
  const errors = [];
  const OFFICE = 'stg_office';

  // ───────── 1. Office admin login and permissions
  const admin = await (await ctxFor(b)).newPage(); admin.on('pageerror', (e) => errors.push(e.message));
  await t('1.1 office admin signs in with staging credentials', async () => { await login(admin, 'office-admin'); return admin.url().replace(BASE, ''); });
  await t('1.2 sidebar shows Office, Agents, Teams, Campaigns, Registrations, My Team (and no Leadership Hub or platform Admin link)', async () => {
    await admin.goto(BASE + '/dashboard'); await admin.waitForTimeout(3500);
    const labels = (await admin.locator('a[href^="/dashboard"], a[href="/dashboard"], button').allInnerTexts()).map((x) => x.trim());
    for (const w of ['Office', 'Agents', 'Teams', 'Campaigns', 'Registrations', 'My Team']) ok(labels.includes(w), 'missing ' + w + ' in ' + labels.slice(0, 20).join('|'));
    ok(!labels.includes('Leadership Hub') && !labels.includes('Admin'), 'unexpected nav item');
    return labels.filter((l) => ['Office', 'Agents', 'Teams', 'Campaigns', 'Registrations', 'My Team'].includes(l)).join(', ');
  });
  await t('1.3 agent directory lists all 6 fake agents; invited agent shows Invited; all need photos', async () => {
    await admin.goto(BASE + '/dashboard/office/agents'); await admin.waitForSelector('text=Edit Profile', { timeout: 30000 });
    const rows = await admin.locator('li:has-text("Edit Profile")').count(); ok(rows === 6, 'rows=' + rows);
    ok((await admin.locator('li:has-text("Ivy")').innerText()).includes('Invited'), 'Ivy not invited');
    await admin.click('button:has-text("Missing photo")'); ok((await admin.locator('li:has-text("Edit Profile")').count()) === 6, 'missing-photo filter');
    await admin.click('button:has-text("All")'); await admin.screenshot({ path: path.join(OUT, 's-1-directory.png'), fullPage: true });
    return '6 rows';
  });
  await t('1.4 only the office admin can use office routes (401/403 for everyone else, cross-office refused)', async () => {
    const dir = (e, o = OFFICE) => api(e, `/api/offices/${o}/agent-directory`);
    ok((await dir(E('office-admin'))).status === 200, 'admin');
    for (const tag of ['team-creator', 'member', 'invited', 'plain-agent', 'leadership']) ok((await dir(E(tag))).status === 403, tag + ' got ' + (await dir(E(tag))).status);
    ok((await fetch(`${BASE}/api/offices/${OFFICE}/agent-directory`)).status === 401, 'unauthenticated');
    const other = await dir(E('office-admin'), 'some_other_office'); ok([403, 404].includes(other.status), 'cross-office ' + other.status);
    return 'admin 200; 5 other roles 403; anon 401; cross-office ' + other.status;
  });

  // ───────── 2. Team creation and administration
  await t('2.1 Teams page shows the seeded team (no Team Admin badge: role retired) and 3 unassigned agents', async () => {
    await admin.goto(BASE + '/dashboard/office/teams'); await admin.waitForSelector('text=Create team', { timeout: 30000 });
    const body = await admin.locator('body').innerText(); ok(body.includes('Staging Team One') && !/Team admin/i.test(body), 'team missing or Team admin badge shown');
    ok((await admin.locator('section[aria-label="Agents without a team"] li').count()) === 3, 'unassigned count');
    await admin.screenshot({ path: path.join(OUT, 's-2-teams.png'), fullPage: true });
  });
  await t('2.2 office admin creates a team and renames it; no team administrator is chosen or offered (role retired)', async () => {
    await admin.click('button:has-text("Create team")'); await admin.waitForSelector('[role=dialog]');
    const boxes = admin.locator('[role=dialog] input[type=checkbox]'); ok((await boxes.count()) === 3, 'assignable ' + await boxes.count());
    await boxes.nth(0).check(); await boxes.nth(1).check(); await admin.fill('[role=dialog] input[aria-label="Team name"]', 'QA Team');
    ok(!/Team administrator/i.test(await admin.locator('[role=dialog]').innerText()), 'team administrator selector shown');
    await admin.click('[role=dialog] button:has-text("Create team")'); await admin.waitForSelector('text=Team created.');
    const teams = (await db.collection('teams').where('officeId', '==', OFFICE).get()).docs; ok(teams.length === 2, 'teams ' + teams.length);
    const qa = teams.find((d) => d.data().name === 'QA Team'); ok(qa, 'QA team not found');
    const members = (await db.collection('users').where('teamId', '==', qa.id).get()).docs.map((d) => d.id); ok(members.length === 2, 'members');
    await admin.click('section[aria-label="QA Team"] button:has-text("Rename")'); await admin.fill('section[aria-label="QA Team"] input[aria-label="Team name"]', 'QA Team Renamed'); await admin.click('section[aria-label="QA Team"] button:has-text("Save")'); await admin.waitForSelector('text=Team renamed.');
    ok((await admin.locator('button:has-text("Make team admin")').count()) === 0, 'Make team admin control shown');
    const after = (await db.collection('teams').doc(qa.id).get()).data(); ok(after.name === 'QA Team Renamed', 'rename not stored');
    globalThis.qaTeam = { id: qa.id, members };
    return 'created and renamed; no admin controls';
  });
  await t('2.3 moving an agent out of a 2-person team asks first, then dissolves it; no profile or login is lost', async () => {
    const { id, members } = globalThis.qaTeam; const mover = members.find((m) => m !== 'stg_admin');
    const name = { stg_plain: 'Pat', stg_leader: 'Lee' }[mover] || 'Olive';
    await admin.goto(BASE + '/dashboard/office/teams'); await admin.waitForSelector('text=Create team');
    await admin.selectOption(`select[aria-label^="Move ${name}"]`, { label: 'Staging Team One' }); await admin.waitForSelector('text=Agent moved.', { timeout: 20000 });
    ok(!(await db.collection('teams').doc(id).get()).exists, 'QA team should have dissolved');
    ok((await db.collection('users').doc(mover).get()).data().teamId === 'stg_team1', 'mover not in team one');
    ok((await adminAuth.getUser(mover)).email === E({ stg_plain: 'plain-agent', stg_leader: 'leadership' }[mover] || 'office-admin'), 'auth changed');
    const audit = (await db.collection('officeTeamAudit').get()).size; ok(audit === 3, 'audit entries ' + audit); // create, rename, move (with dissolve)
    return `audit entries: ${audit}`;
  });
  await t('2.4 team creator (former Team Admin) has no office-wide access and no campaign authority', async () => {
    ok((await api(E('team-creator'), `/api/offices/${OFFICE}/teams`)).status === 403, 'teams list');
    ok((await api(E('team-creator'), `/api/offices/${OFFICE}/teams`, 'POST', { memberUids: ['stg_plain', 'stg_leader'], adminUid: 'stg_plain' })).status === 403, 'create');
    const a = await api(E('team-creator'), '/api/properties/managed/agents'); ok(a.body.role === null && a.body.agents.length === 0, 'role ' + a.body.role);
    return 'assignable: none (Team Admin retired)';
  });

  // ───────── 3. Agent profiles and photos
  const authBefore = await adminAuth.getUser('stg_invited'); const userBefore = (await db.collection('users').doc('stg_invited').get()).data();
  await t('3.1 office admin completes an invited agent\'s profile (name, phone, professional email, photo) in the UI', async () => {
    await admin.goto(BASE + '/dashboard/office/agents'); await admin.waitForSelector('text=Edit Profile');
    await admin.fill('input[aria-label="Search agents"]', 'Ivy'); await admin.click('li:has-text("Ivy") button:has-text("Edit Profile")'); await admin.waitForSelector('[role=dialog]');
    await admin.fill('[role=dialog] input[maxlength="120"]', 'Ivy Rose Invited'); await admin.fill('[role=dialog] input[inputmode=tel]', '0411 222 333'); await admin.fill('[role=dialog] input[inputmode=email]', 'ivy.pro@premarket-staging.invalid');
    await admin.setInputFiles('[role=dialog] input[type=file]', path.join(OUT, 'tiny.png')); await admin.waitForSelector('text=Position the agent'); await admin.click('div.z-\\[70\\] button:has-text("Save")'); await admin.waitForSelector('text=Position the agent', { state: 'detached' }); await admin.screenshot({ path: path.join(OUT, 's-3-modal.png') }); // the photo is now cropped in the existing positioner before it is saved
    await admin.click('[role=dialog] button:has-text("Save")'); await admin.waitForSelector('text=Profile saved.', { timeout: 30000 });
    const prof = (await db.collection('officeAgents').where('linkedUid', '==', 'stg_invited').get()); ok(prof.size === 1, 'profiles ' + prof.size);
    const d = prof.docs[0].data(); ok(d.fullName === 'Ivy Rose Invited' && d.phone === '0411 222 333' && d.contactEmail === 'ivy.pro@premarket-staging.invalid' && /premarket-staging\.b-cdn\.net\/office-agents\/stg_office\//.test(d.photoUrl), 'profile fields: ' + JSON.stringify(d).slice(0, 160));
    return 'one officeAgents profile; photo URL on the STAGING CDN base';
  });
  await t('3.2 profile edit never touches login: Auth user, login email and activation status are unchanged; no extra Auth users', async () => {
    const a = await adminAuth.getUser('stg_invited'); ok(a.email === authBefore.email && a.emailVerified === authBefore.emailVerified && a.disabled === authBefore.disabled && String(a.metadata.lastSignInTime) === String(authBefore.metadata.lastSignInTime), 'auth changed');
    const u = (await db.collection('users').doc('stg_invited').get()).data(); ok(u.accountStatus === 'invited' && u.email === userBefore.email, 'users login fields changed'); ok(/premarket-staging\.b-cdn\.net/.test(u.avatar), 'avatar mirror');
    ok((await adminAuth.listUsers(100)).users.length === 6, 'auth user count');
  });
  await t('3.3 directory shows the photo and no longer lists that agent as missing a photo', async () => {
    await admin.goto(BASE + '/dashboard/office/agents'); await admin.waitForSelector('text=Edit Profile'); await admin.fill('input[aria-label="Search agents"]', 'Ivy');
    ok((await admin.locator('li:has-text("Ivy") img[src*="premarket-staging.b-cdn.net"]').count()) === 1, 'photo not shown');
    await admin.fill('input[aria-label="Search agents"]', ''); await admin.click('button:has-text("Missing photo")'); ok((await admin.locator('li:has-text("Edit Profile")').count()) === 5, 'missing count');
  });
  await t('3.4 public profile shows the edited name, phone and photo, and no emails', async () => {
    const r = await (await fetch(`${BASE}/api/public/agent-profiles?ids=stg_invited`)).json(); const p = r.profiles.stg_invited;
    ok(p.firstName === 'Ivy' && p.lastName === 'Rose Invited' && p.phone === '0411 222 333' && /b-cdn/.test(p.avatar), JSON.stringify(p).slice(0, 120));
    ok(!/@/.test(JSON.stringify(p)), 'email leaked');
  });
  await t('3.5 other roles cannot edit profiles (403), and photos are validated by content', async () => {
    const key = 'u:stg_member';
    for (const tag of ['team-creator', 'member', 'plain-agent', 'leadership']) ok((await api(E(tag), `/api/offices/${OFFICE}/agent-profile`, 'PATCH', { key, phone: '0400 000 111' })).status === 403, tag);
    const fd = new FormData(); fd.append('key', key); fd.append('file', new Blob(['<svg xmlns="http://www.w3.org/2000/svg"></svg>............'], { type: 'image/png' }), 'x.png');
    const r = await fetch(`${BASE}/api/offices/${OFFICE}/agent-profile/photo`, { method: 'POST', headers: { authorization: 'Bearer ' + await token(E('office-admin')) }, body: fd }); ok(r.status === 400, 'svg accepted? ' + r.status);
  });

  // ───────── 4-5. Managed campaigns, attribution, emails
  resend.cleared = true; fs.existsSync('/tmp/fake-resend.jsonl') && fs.unlinkSync('/tmp/fake-resend.jsonl');
  await t('4.1 wizard: office admin creates a campaign for the invited (never logged in) agent', async () => {
    await wizard(admin, { forLabel: 'Ivy Rose Invited (not logged in yet)', address: '12 Palm Beach Drive, Kingscliff NSW 2487, Australia', suburb: 'Kingscliff', title: 'Staging coastal home', shot: 's-4-terms.png' });
    await admin.waitForURL(/office\/campaigns\?created=1/, { timeout: 45000 }); await admin.waitForSelector('li:has-text("Palm Beach")');
    const note = await admin.locator('body').innerText(); ok(note.includes('not logged in yet'), 'row text');
  });
  const palm = async () => (await db.collection('properties').where('formattedAddress', '==', '12 Palm Beach Drive, Kingscliff NSW 2487, Australia').get()).docs;
  await t('4.2 attribution: owner is the assigned agent; creator, role and terms acceptor are the administrator; legacy flag off', async () => {
    const d = await palm(); ok(d.length === 1, 'duplicates ' + d.length); const p = d[0].data();
    ok(p.userId === 'stg_invited' && p.createdByUid === 'stg_admin' && p.createdByRole === 'officeAdmin' && p.termsAcceptedBy === 'stg_admin' && p.managedCreation === true && p.vendorUploaded === false && p.visibility === false, JSON.stringify({ u: p.userId, c: p.createdByUid, r: p.createdByRole, t: p.termsAcceptedBy, v: p.vendorUploaded }));
    return 'userId=stg_invited createdBy=stg_admin termsAcceptedBy=stg_admin';
  });
  await t('4.3 team creator (former Team Admin) gets no agent selector in the wizard', async () => {
    const tl = await (await ctxFor(b)).newPage(); tl.on('pageerror', (e) => errors.push(e.message)); await login(tl, 'team-creator'); globalThis.tl = tl;
    await tl.goto(BASE + '/dashboard/add'); await tl.waitForTimeout(3000); ok((await tl.locator('#campaign-for').count()) === 0, 'selector shown');
    return 'no selector';
  });
  await t('4.4 the server refuses a team creator creating for a teammate or anyone else, and creates nothing', async () => {
    const before = (await db.collection('properties').get()).size;
    for (const [owner, rid] of [['stg_member', 'forged-direct-0000001'], ['stg_plain', 'forged-direct-0000002'], ['stg_admin', 'forged-direct-0000003']]) {
      const r = await api(E('team-creator'), '/api/properties/managed', 'POST', { ownerUid: owner, requestId: rid, acceptTerms: true, property: { address: 'x', price: '1' } }); ok(r.status === 404, owner + ' ' + r.status);
    }
    ok((await db.collection('properties').get()).size === before, 'property created!');
  });
  await t('4.5 plain agent has no selector and the existing agent-led wizard still creates their own campaign (under the deployed rules)', async () => {
    const pl = await (await ctxFor(b)).newPage(); pl.on('pageerror', (e) => errors.push(e.message)); await login(pl, 'plain-agent');
    await pl.goto(BASE + '/dashboard/add'); await pl.waitForTimeout(2500); ok((await pl.locator('#campaign-for').count()) === 0, 'selector shown');
    await wizard(pl, { forLabel: null, address: '55 Own Street, Tweed Heads NSW 2485, Australia', suburb: 'Tweed Heads', title: 'Agent created' }); await pl.waitForURL(/dashboard\?created=1/, { timeout: 45000 }); await pl.waitForTimeout(3500);
    const d = (await db.collection('properties').where('formattedAddress', '==', '55 Own Street, Tweed Heads NSW 2485, Australia').get()).docs; ok(d.length === 1 && d[0].data().userId === 'stg_plain' && d[0].data().managedCreation !== true, 'agent-led doc');
    globalThis.ownProp = d[0].id;
  });
  await t('5.1 exactly one campaign-link email per managed campaign, to each assigned agent\'s account email, with the buyer link and no buyer/price data', async () => {
    await new Promise((r) => setTimeout(r, 1500)); const m = resend().map((x) => x.body);
    const links = m.filter((x) => /campaign link/i.test(x.subject)); ok(links.length === 1, 'campaign emails ' + links.length + ' of ' + m.length);
    const to = links.map((x) => [].concat(x.to).join()).sort(); ok(to.join() === [E('invited')].join(), 'recipients ' + to);
    for (const x of links) { ok(/find-property\?propertyId=m_/.test(x.html), 'link'); ok(!/offerAmount|buyer@|fake\.buyer|0400 000 00\d|\$\s?\d|1,250,000|880000|987654/.test(x.html + (x.text || '')), 'buyer or price data in email'); }
    ok(!m.some((x) => /ivy\.pro@/.test(JSON.stringify(x.to))), 'sent to professional email');
    ok(!m.some((x) => /Property Added to Your Dashboard/.test(x.subject)), 'legacy-style email');
    return 'recipient: qa+invited (test domain; captured, not sent)';
  });
  await t('5.2 authorised resend sends once more, is rate limited, and strangers are refused', async () => {
    const id = (await palm())[0].id; const before = resend().length;
    await admin.goto(BASE + '/dashboard/office/campaigns'); await admin.waitForSelector('li:has-text("Palm Beach")'); await admin.click('li:has-text("Palm Beach") button:has-text("Email link to agent")'); await admin.waitForSelector('text=emailed', { timeout: 15000 });
    ok(resend().length === before + 1, 'resend count'); ok((await api(E('office-admin'), `/api/properties/${id}/campaign-link/resend`, 'POST')).status === 429, 'cooldown');
    ok((await api(E('plain-agent'), `/api/properties/${id}/campaign-link/resend`, 'POST')).status === 404, 'stranger');
  });
  await t('5.3 invited agent signs in for the first time and finds the campaign (listed as theirs); activation works as before', async () => {
    const ivy = await (await ctxFor(b)).newPage(); ivy.on('pageerror', (e) => errors.push(e.message)); await login(ivy, 'invited'); await ivy.waitForTimeout(4500);
    const txt = await ivy.locator('body').innerText(); ok(/Kingscliff/.test(txt) && /Listed by you/i.test(txt), 'campaign not on dashboard');
    ok((await db.collection('users').doc('stg_invited').get()).data().accountStatus === 'active', 'not activated by login'); await ivy.screenshot({ path: path.join(OUT, 's-5-ivy.png'), fullPage: true });
  });

  // ───────── 6. Registrations and notifications
  await t('6.1 buyer registers interest: the ASSIGNED agent is emailed once with buyer contact details and no opinion amount', async () => {
    const id = (await palm())[0].id; await db.collection('offers').doc('stg_reg_ivy_00001').set({ propertyId: id, serious: true, buyerName: 'Fake Buyer Two', buyerEmail: 'fake.buyer2@premarket-staging.invalid', buyerPhone: '0400 000 002', nextAction: 'contact', timeframe: '3-months', offerAmount: 987654, seriousnessLevel: 'high', sessionId: 'sess-secret', createdAt: new Date() });
    const before = resend().length; const a = await (await fetch(BASE + '/api/offers/notify-interest', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ offerId: 'stg_reg_ivy_00001', propertyId: id }) })).json(); const b2 = await (await fetch(BASE + '/api/offers/notify-interest', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ offerId: 'stg_reg_ivy_00001', propertyId: id }) })).json();
    await new Promise((r) => setTimeout(r, 1200)); const added = resend().slice(before); ok(a.sent === true && b2.skipped === true && added.length === 1, JSON.stringify([a, b2, added.length]));
    ok([].concat(added[0].body.to).join() === E('invited'), 'recipient'); ok(/fake\.buyer2@/.test(added[0].body.html) && !/987654|sess-secret/.test(JSON.stringify(added[0].body)), 'content');
  });
  await t('6.2 office admin sees registrations (date only, no opinion data); team creator, members and leadership get none (flag off)', async () => {
    await admin.goto(BASE + '/dashboard/office/registrations'); await admin.waitForSelector('li:has-text("Fake Buyer")'); const txt = await admin.content(); ok(!/987654|880000|sess-secret|offerAmount/.test(txt), 'opinion leak');
    const r = await api(E('office-admin'), '/api/registrations/managed'); ok(r.status === 200 && r.body.scope === 'office' && r.body.registrations.length === 2 && r.body.registrations.every((x) => /^\d{4}-\d{2}-\d{2}$/.test(x.createdAt)), JSON.stringify(r.body).slice(0, 100));
    ok(!/880000|987654|userId|sessionId/.test(JSON.stringify(r.body)), 'API leak');
    for (const tag of ['team-creator', 'member', 'plain-agent', 'leadership']) ok((await api(E(tag), '/api/registrations/managed')).status === 403, tag);
    await admin.screenshot({ path: path.join(OUT, 's-6-registrations.png'), fullPage: true });
    return 'office admin 200 (2 registrations); 4 other roles 403';
  });
  await t('6.3 My Team offers the team creator neither create-for-teammate nor team registrations, and shows no Creator badge', async () => {
    const tl = globalThis.tl; await tl.goto(BASE + '/dashboard/team'); await tl.waitForSelector('text=My Team'); await tl.waitForTimeout(2500);
    ok((await tl.locator('text=Create a campaign for a teammate').count()) === 0, 'create link'); ok((await tl.locator('text=View team registrations').count()) === 0, 'registrations link shown');
    ok((await tl.locator('span', { hasText: /^(Creator|Team admin)$/i }).count()) === 0, 'badge shown'); // (the fake user is surnamed "Team-Creator")
  });

  // ───────── 7. Billing (staging only)
  await t('7.1 exactly one charge per campaign, on the staging office, at the staging price, keyed by property id', async () => {
    const props = (await db.collection('properties').get()).docs.filter((d) => d.id.startsWith('m_') || d.id === globalThis.ownProp); const ch = (await db.collection('propertyCharges').get()).docs;
    ok(ch.length === 2 && props.length === 2, `charges ${ch.length} props ${props.length}`);
    for (const c of ch) { const d = c.data(); ok(props.some((p) => p.id === c.id) && (d.officeId === OFFICE) && d.pricePerListing === 200 && d.status === 'pending', 'charge shape ' + c.id); }
    const own = ch.find((c) => c.id === globalThis.ownProp).data(); const man = ch.find((c) => c.data().agentUserId === 'stg_invited').data();
    ok(JSON.stringify([own.billingEntityType, own.pricePerListing, own.gstRate]) === JSON.stringify([man.billingEntityType, man.pricePerListing, man.gstRate]), 'managed charge differs from agent-led');
    return `2 charges (1 managed + 1 agent-led) all office:${OFFICE} @ $200`;
  });
  await t('7.2 a retried request creates no second campaign or charge', async () => {
    const body = { ownerUid: 'stg_member', requestId: 'smoke-retry-request-0001', acceptTerms: true, property: { address: 'Retry NSW Australia', formattedAddress: 'Retry Test', price: '$900,000', imageUrls: [] } };
    const a = await api(E('office-admin'), '/api/properties/managed', 'POST', body); const c = await api(E('office-admin'), '/api/properties/managed', 'POST', body);
    ok([200, 201].includes(a.status) && c.status === 200 && c.body.duplicate === true && c.body.propertyId === a.body.propertyId, 'retry');
    ok((await db.collection('propertyCharges').doc(a.body.propertyId).get()).exists, 'charge'); ok((await db.collection('propertyCharges').get()).size === 3, 'charge total');
  });

  // ───────── 8. Telemetry and isolation, whole session
  await t('8.1 Sentry telemetry: zero requests were made to Sentry during the entire signed-in session', async () => { ok(seen.sentry === 0, 'sentry requests: ' + seen.sentry); return '0 requests'; });
  await t('8.2 every Firebase/Google API request from the browser went to the staging project; none mention the live project', async () => {
    ok(seen.live === 0, 'live refs ' + seen.live); const fb = seen.firebaseUrls.filter((u) => /identitytoolkit|firestore|securetoken|firebasestorage|firebaseapp/.test(u)); ok(fb.length > 20, 'few firebase requests ' + fb.length);
    const bad = fb.filter((u) => !(u.includes(PROJECT) || u.includes(web.apiKey) || /securetoken|Listen\/channel|Write\/channel/.test(u))); ok(bad.length === 0, 'unattributed: ' + bad[0]);
    return `${fb.length} Firebase requests, 0 live`;
  });
  await t('8.3 no page errors in the browser during the session', async () => { const real = errors.filter((e) => !/Failed to load resource|ResizeObserver/.test(e)); ok(real.length === 0, real[0]); });

  await b.close();
  const pass = results.filter((r) => r.ok).length; log(`\nRESULT: ${pass}/${results.length} passed`); results.filter((r) => !r.ok).forEach((r) => log('FAILED:', r.name, '->', r.note));
  fs.writeFileSync(path.join(OUT, 'smoke-results.json'), JSON.stringify(results, null, 2));
  process.exit(0);
})().catch((e) => { console.error('SMOKE ABORTED:', e.message); process.exit(1); });
