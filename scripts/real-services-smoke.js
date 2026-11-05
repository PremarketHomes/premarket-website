#!/usr/bin/env node
/**
 * ONE real-services check against the STAGING app using controlled accounts: a real photo upload (Bunny staging zone) and a real
 * campaign-link email (Resend) delivered to a mailbox you control. No fakes are involved: run the app WITHOUT the local preload.
 *
 * Prerequisites (you provide): ~/.premarket-staging/real-services.env containing RESEND_API_KEY, BUNNY_STORAGE_ACCESS_KEY, BUNNY_STORAGE_ZONE,
 * BUNNY_CDN_BASE, EMAIL_ALLOWLIST=<your mailbox>; staging reseeded with that mailbox (`seed-staging.js --qa-email <mailbox>`); the app running
 * with that env (staging Firebase). Usage: node scripts/real-services-smoke.js --url http://localhost:3200 --mailbox you@yourdomain.com
 *
 * It refuses to run unless the app reports a non-live backend. It creates exactly ONE staging campaign for the seeded invited agent and
 * uploads ONE photo. It reads the Resend API afterwards to report the delivery status of that one email.
 */
const fs = require('fs'); const os = require('os'); const path = require('path');
const arg = (n) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : null; };
const BASE = (arg('--url') || 'http://localhost:3200').replace(/\/$/, ''); const MAILBOX = arg('--mailbox');
const HOME = os.homedir(); const web = require(path.join(HOME, '.premarket-staging/web-config.json'));
const env = Object.fromEntries(fs.readFileSync(path.join(HOME, '.premarket-staging/real-services.env'), 'utf8').split('\n').filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]));
const pwFile = fs.readFileSync(path.join(HOME, '.premarket-staging/seed-output.txt'), 'utf8');
const plus = (tag) => { const [u, d] = MAILBOX.split('@'); return `${u}+${tag}@${d}`; };
const passwordOf = (email) => (pwFile.split('\n').map((l) => l.match(/^\s+(\S+@\S+)\s+(\S+)$/)).find((m) => m && m[1] === email) || [])[2];
const say = (ok, m) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${m}`); if (!ok) process.exitCode = 1; return ok; };

(async () => {
  if (!MAILBOX || !/^[^@\s+]+@[^@\s]+\.[^@\s]+$/.test(MAILBOX)) throw new Error('--mailbox must be a plain address you control');
  const e = await (await fetch(`${BASE}/api/internal/environment`)).json();
  if (e.pointsAtLiveBackend !== false || e.serverProjectId === 'premarket-homes' || e.clientMatchesServer !== true) throw new Error('REFUSING: app is not on a staging backend: ' + JSON.stringify(e));
  if (/premarketvideos/.test(String(e.storageZone))) throw new Error('REFUSING: app is using the live storage zone');
  console.log('backend:', e.serverProjectId, '| storage zone:', e.storageZone, '| email guard:', JSON.stringify(e.emailGuard));
  const login = async (tag) => { const r = await (await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${web.apiKey}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: plus(tag), password: passwordOf(plus(tag)), returnSecureToken: true }) })).json(); if (!r.idToken) throw new Error('sign-in failed for ' + tag); return r.idToken; };
  const adminTok = await login('office-admin');
  // 1. real photo upload (valid JPEG) through the office photo route, then fetch it back from the CDN
  const jpeg = Buffer.from('/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAAMCAgMCAgMDAwMEAwMEBQgFBQQEBQoHBwYIDAoMDAsKCwsNDhIQDQ4RDgsLEBYQERMUFRUVDA8XGBYUGBIUFRT/2wBDAQMEBAUEBQkFBQkUDQsNFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBT/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAn/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFAEBAAAAAAAAAAAAAAAAAAAAAP/EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAMAwEAAhEDEQA/AL+AB//Z', 'base64');
  const fd = new FormData(); fd.append('key', 'u:stg_invited'); fd.append('file', new Blob([jpeg], { type: 'image/jpeg' }), 'smoke.jpg');
  const up = await fetch(`${BASE}/api/offices/stg_office/agent-profile/photo`, { method: 'POST', headers: { authorization: 'Bearer ' + adminTok }, body: fd }); const upBody = await up.json().catch(() => ({}));
  if (!say(up.status === 200 && !!upBody.url, `photo upload accepted by the app (HTTP ${up.status}) ${upBody.url || upBody.error || ''}`)) return;
  const cdn = await fetch(upBody.url); say(cdn.status === 200 && /^image\//.test(cdn.headers.get('content-type') || ''), `photo is served from the CDN (HTTP ${cdn.status}, ${cdn.headers.get('content-type')})`);
  // 2. one managed campaign for the invited agent -> real email to the controlled mailbox
  const body = { ownerUid: 'stg_invited', requestId: 'real-smoke-' + Date.now().toString(16).padStart(16, '0'), acceptTerms: true, property: { address: 'Real Smoke NSW Australia', formattedAddress: '1 Smoke Test St, Real Smoke NSW 2000, Australia', price: '$900,000', imageUrls: [upBody.url] } };
  const cr = await fetch(`${BASE}/api/properties/managed`, { method: 'POST', headers: { authorization: 'Bearer ' + adminTok, 'content-type': 'application/json' }, body: JSON.stringify(body) }); const crb = await cr.json().catch(() => ({}));
  if (!say(cr.status === 201 && crb.notification === 'sent', `campaign created, notification status: ${crb.notification} (HTTP ${cr.status})`)) return;
  // 3. ask Resend what happened to that one email
  await new Promise((r) => setTimeout(r, 6000));
  const list = await (await fetch('https://api.resend.com/emails?limit=5', { headers: { authorization: `Bearer ${env.RESEND_API_KEY}` } })).json().catch(() => ({}));
  const mine = (list.data || []).find((m) => /campaign link/i.test(m.subject || '') && JSON.stringify(m.to).includes(plus('invited')));
  say(!!mine, mine ? `Resend shows the email to ${plus('invited')}: status "${mine.last_event}"` : 'no matching email found in Resend');
  console.log(`\nNow confirm by eye: the email "Your Premarket campaign link: 1 Smoke Test St..." arrived in ${MAILBOX}, looks right, and its link opens the campaign page.`);
})().catch((err) => { console.error('STOPPED:', err.message); process.exit(1); });
