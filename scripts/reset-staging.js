#!/usr/bin/env node
// STAGING ONLY: wipes the fake data (Firestore collections and Auth users) so a seed can be re-run. Refuses the live project.
const { initializeApp, cert } = require('firebase-admin/app'); const { getFirestore } = require('firebase-admin/firestore'); const { getAuth } = require('firebase-admin/auth');
const sa = require(require('os').homedir() + '/.premarket-staging/staging-sa.json');
if (sa.project_id === 'premarket-homes' || !/staging/.test(sa.project_id)) throw new Error('REFUSING: not a staging project: ' + sa.project_id);
const app = initializeApp({ credential: cert(sa), projectId: sa.project_id }); const db = getFirestore(app);
(async () => {
  const cols = await db.listCollections(); for (const c of cols) await db.recursiveDelete(c);
  let n = 0; let page = await getAuth(app).listUsers(1000); while (page.users.length) { await getAuth(app).deleteUsers(page.users.map((u) => u.uid)); n += page.users.length; page = await getAuth(app).listUsers(1000); }
  console.log(`reset ${sa.project_id}: deleted ${cols.length} collections and ${n} auth users`);
})().catch((e) => { console.error(e.message); process.exit(1); });
