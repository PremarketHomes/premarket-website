/**
 * Background media upload manager (client side).
 *
 * Why: uploads used to run as a closure inside the Add/Edit page. Any failure was only console-logged, the property stayed
 * "uploading" forever, nothing could be retried, and a reload, sleep or closed tab lost the files entirely.
 *
 * What this does:
 *  - Jobs live in this module (not in a component), so they keep running while the user navigates inside Premarket.
 *  - Every file is saved to IndexedDB before uploading. Completed files are recorded on the property; unfinished ones are kept
 *    so they can be resumed after a reload, sleep or closed browser (the browser cannot upload while closed or asleep).
 *  - Retries: each file is retried automatically; if it still fails the job is "interrupted" and waits for Resume.
 *  - No duplicates: a deterministic storage path per file (overwrite on retry), completed files are never re-uploaded, and
 *    URLs are attached with arrayUnion. Managed campaigns reuse their idempotent requestId; photos added by a campaign's
 *    manager (who cannot write the property directly) are attached through the server, which ignores URLs already there.
 *  - Media is only marked complete (imageUploadProgress.inProgress=false) after EVERY file has uploaded.
 *
 * Firebase Storage's resumable session cannot be restored by the browser SDK after a reload, so "resume" means: skip the files
 * that finished, re-send the ones that did not.
 */

const DB_NAME = 'premarket-uploads';
const STORE = 'jobs';
const MAX_ATTEMPTS = 3;
const BACKOFF_MS = [1000, 3000];

const jobs = new Map(); // id -> job (blobs held in memory while the tab is open)
const running = new Set();
const waiters = new Map(); // job id -> resolve fns (kept out of the job so it stays storable)
const listeners = new Set();
let deps = null;
let restored = false;
let snapshot = [];

/* ───────────── dependencies (overridable in tests) ───────────── */

async function defaultDeps() {
  const [{ db, storage, auth }, fsMod, stMod, { authFetch }] = await Promise.all([
    import('../firebase/clientApp'), import('firebase/firestore'), import('firebase/storage'), import('./authFetch'),
  ]);
  return {
    currentUid: () => auth.currentUser?.uid || null,
    uploadFile: (path, blob, contentType, onProgress) => new Promise((resolve, reject) => {
      const task = stMod.uploadBytesResumable(stMod.ref(storage, path), blob, { contentType });
      task.on('state_changed', (s) => onProgress?.(s.bytesTransferred / (s.totalBytes || 1)), reject,
        () => stMod.getDownloadURL(task.snapshot.ref).then(resolve, reject));
    }),
    updateProperty: (propertyId, patch) => {
      const out = {};
      for (const [k, v] of Object.entries(patch)) out[k === 'imageUrls+' ? 'imageUrls' : k] = k === 'imageUrls+' ? fsMod.arrayUnion(v) : v;
      return fsMod.updateDoc(fsMod.doc(db, 'properties', propertyId), out);
    },
    apiUpload: async (file) => {
      const fd = new FormData(); fd.append('file', file);
      const res = await authFetch('/api/upload-image', { method: 'POST', body: fd });
      if (!res.ok) { const e = new Error('A photo could not be uploaded.'); e.status = res.status; throw e; }
      return (await res.json()).url;
    },
    apiCreateManaged: async (body) => {
      const res = await authFetch('/api/properties/managed', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const out = await res.json().catch(() => ({}));
      if (!res.ok) { const e = new Error(out.error || 'The campaign could not be created.'); e.status = res.status; throw e; }
      return out;
    },
    apiAttachManagedMedia: async (propertyId, urls) => {
      const res = await authFetch(`/api/properties/${encodeURIComponent(propertyId)}/managed/media`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ urls }) });
      const out = await res.json().catch(() => ({}));
      if (!res.ok) { const e = new Error(out.error || 'The photos could not be added to the campaign.'); e.status = res.status; throw e; }
      return out;
    },
    triggerCompress: (propertyId) => fetch('/api/images/compress', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ propertyId }) }).catch(() => {}),
    convertHeic: async (file) => {
      const n = (file.name || '').toLowerCase();
      if (!(n.endsWith('.heic') || n.endsWith('.heif') || file.type === 'image/heic' || file.type === 'image/heif')) return file;
      const { default: heic2any } = await import('heic2any');
      const blob = await heic2any({ blob: file, toType: 'image/jpeg', quality: 0.85 });
      return new File([blob], file.name.replace(/\.heic$|\.heif$/i, '.jpg'), { type: 'image/jpeg' });
    },
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
  };
}
const getDeps = async () => (deps ||= await defaultDeps());
export function __setDepsForTests(d) { deps = d; }
export function __resetForTests() { jobs.clear(); running.clear(); waiters.clear(); restored = false; snapshot = []; deps = null; memStore.clear(); }

/* ───────────── persistence (IndexedDB, best effort) ───────────── */

const memStore = new Map();
let idbPromise = null;
const hasIdb = () => typeof indexedDB !== 'undefined';
function openDb() {
  if (!hasIdb()) return Promise.resolve(null);
  return (idbPromise ||= new Promise((resolve) => {
    try {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'id' });
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch { resolve(null); }
  }));
}
const tx = async (mode, fn) => {
  const d = await openDb();
  if (!d) return null;
  return new Promise((resolve) => {
    try {
      const t = d.transaction(STORE, mode); const out = fn(t.objectStore(STORE));
      t.oncomplete = () => resolve(out?.result ?? true); t.onerror = () => resolve(null); t.onabort = () => resolve(null);
    } catch { resolve(null); }
  });
};
const persist = async (job) => { memStore.set(job.id, true); await tx('readwrite', (s) => s.put(job)); };
const unpersist = async (id) => { memStore.delete(id); await tx('readwrite', (s) => s.delete(id)); };

/* ───────────── state ───────────── */

function emit() {
  snapshot = [...jobs.values()].map(view);
  listeners.forEach((l) => l());
}
const view = (j) => ({
  id: j.id, kind: j.kind, userId: j.userId, label: j.label, status: j.status, message: j.message || '',
  propertyId: j.propertyId || null, redirectTo: j.redirectTo || null,
  total: j.items.length, done: j.items.filter((i) => i.status === 'done').length,
  progress: j.items.length ? j.items.reduce((a, i) => a + (i.status === 'done' ? 1 : (i.progress || 0)), 0) / j.items.length : 1,
  remaining: j.items.filter((i) => i.status !== 'done').length,
});
export const subscribe = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };
export const getJobs = () => snapshot;
export const hasActiveUploads = () => [...jobs.values()].some((j) => j.status === 'uploading');
const setStatus = (j, status, message = '') => { j.status = status; j.message = message; emit(); };

const newId = () => (globalThis.crypto?.randomUUID?.() || `${Date.now()}${Math.random().toString(16).slice(2)}`).replace(/[^A-Za-z0-9-]/g, '');
const safeName = (n) => String(n || 'file').replace(/[^a-zA-Z0-9._-]/g, '_').slice(-80);
const mkItem = (kind, file) => (typeof file === 'string'
  ? { id: newId(), kind: 'image', status: 'done', url: file, name: 'existing' }
  : { id: newId(), kind, status: 'pending', name: file.name || 'file', type: file.type || '', size: file.size || 0, blob: file, progress: 0 });

/* ───────────── running ───────────── */

async function withRetry(d, fn) {
  let lastErr;
  for (let a = 0; a < MAX_ATTEMPTS; a++) {
    try { return await fn(); } catch (e) {
      lastErr = e;
      if (e && e.status >= 400 && e.status < 500 && e.status !== 408 && e.status !== 429) throw e; // not worth retrying
      if (a < MAX_ATTEMPTS - 1) await d.sleep(BACKOFF_MS[a]);
    }
  }
  throw lastErr;
}

async function uploadItem(d, job, item) {
  if (item.kind === 'image' && !item.converted) {
    const f = await d.convertHeic(item.blob);
    if (f !== item.blob) { item.blob = f; item.name = f.name; item.type = f.type; }
    item.converted = true;
  }
  const onProgress = (p) => { item.progress = p; emit(); };
  if (job.kind === 'managed' || job.kind === 'managedMedia') return withRetry(d, () => d.apiUpload(item.blob));
  const folder = item.kind === 'video' ? 'propertyVideos' : 'propertyImages';
  // Deterministic path: a retry overwrites the same object instead of creating a second one.
  // Same folder depth as before (propertyImages/{uid}/{file}) so existing storage rules keep matching.
  const path = `${folder}/${job.userId}/${job.propertyId}-${item.id}-${safeName(item.name)}`;
  return withRetry(d, () => d.uploadFile(path, item.blob, item.type || undefined, onProgress));
}

async function run(job) {
  if (running.has(job.id)) return;
  running.add(job.id); // synchronously, so waitFor() never mistakes a job that is about to start for a finished one
  setStatus(job, 'uploading');
  try {
    const d = await getDeps();
    if (d.currentUid() !== job.userId) { setStatus(job, 'interrupted', 'Sign in as the same user to resume this upload.'); return; }
    for (const item of job.items) {
      if (item.status === 'done') continue;
      let url;
      try { url = await uploadItem(d, job, item); } catch (e) {
        setStatus(job, 'interrupted', 'Some files did not upload. The ones that finished are saved. Press Resume to send the rest.');
        await persist(job);
        if (job.kind === 'property') await d.updateProperty(job.propertyId, { 'imageUploadProgress.interrupted': true }).catch(() => {});
        return;
      }
      item.status = 'done'; item.url = url; item.blob = null; item.progress = 1;
      if (job.kind === 'property') {
        const doneImages = job.items.filter((i) => i.kind === 'image' && i.status === 'done').length;
        const patch = item.kind === 'video' ? { videoUrl: url }
          : { 'imageUrls+': url, 'imageUploadProgress.uploaded': doneImages, 'imageUploadProgress.total': job.items.filter((i) => i.kind === 'image').length, 'imageUploadProgress.inProgress': true, 'imageUploadProgress.interrupted': false };
        try { await d.updateProperty(job.propertyId, patch); } catch (e) {
          item.status = 'pending'; item.url = null; // could not attach it: do not count it as done
          setStatus(job, 'interrupted', 'Could not save a photo to the campaign. Press Resume to try again.'); await persist(job); return;
        }
      }
      emit(); await persist(job);
    }

    if (job.kind === 'managed') {
      const urls = job.items.map((i) => i.url);
      const out = await withRetry(d, () => d.apiCreateManaged({ ...job.payload, requestId: job.requestId, property: { ...job.payload.property, imageUrls: urls } }));
      job.propertyId = out.propertyId || out.id || null;
    } else if (job.kind === 'managedMedia') {
      const urls = job.items.map((i) => i.url);
      await withRetry(d, () => d.apiAttachManagedMedia(job.propertyId, urls));
      d.triggerCompress(job.propertyId);
    } else {
      const hasImages = job.items.some((i) => i.kind === 'image');
      const total = job.items.filter((i) => i.kind === 'image').length;
      await d.updateProperty(job.propertyId, {
        'imageUploadProgress.uploaded': total, 'imageUploadProgress.total': total,
        'imageUploadProgress.inProgress': false, 'imageUploadProgress.interrupted': false,
        ...(hasImages ? { imagesCompressed: false } : {}),
      });
      if (hasImages) d.triggerCompress(job.propertyId);
    }
    setStatus(job, 'complete', job.kind === 'managed' ? 'Campaign created.' : job.kind === 'managedMedia' ? 'Photos added.' : 'All media uploaded.');
    await unpersist(job.id);
  } catch (e) {
    const permanent = e && e.status >= 400 && e.status < 500 && e.status !== 408 && e.status !== 429;
    setStatus(job, permanent ? 'error' : 'interrupted', e?.message || 'The upload was interrupted. Press Resume.');
    await persist(job);
  } finally {
    running.delete(job.id);
    (waiters.get(job.id) || []).splice(0).forEach((w) => w(job));
  }
}

const waitFor = (job) => new Promise((resolve) => {
  if (['complete', 'error', 'interrupted'].includes(job.status) && !running.has(job.id)) return resolve(job);
  waiters.set(job.id, [...(waiters.get(job.id) || []), resolve]);
});

/* ───────────── public API ───────────── */

/** Property already saved; upload its new photos (and optional video) in the background. */
export async function enqueuePropertyUpload({ propertyId, userId, label, files = [], video = null }) {
  const job = {
    id: newId(), kind: 'property', userId, propertyId, label: label || 'Campaign media', status: 'queued', createdAt: Date.now(),
    items: [...files.map((f) => mkItem('image', f)), ...(video ? [mkItem('video', video)] : [])],
  };
  jobs.set(job.id, job); emit();
  await persist(job);
  run(job);
  return job.id;
}

/**
 * New photos for a campaign the user MANAGES but does not own (managing BSO, office admin): upload each photo through the
 * server, then attach them all through the server in one idempotent call. Runs in the background like every other job.
 */
export async function enqueueManagedMediaUpload({ propertyId, userId, label, files = [] }) {
  const job = {
    id: newId(), kind: 'managedMedia', userId, propertyId, label: label || 'Campaign photos', status: 'queued', createdAt: Date.now(),
    items: files.map((f) => mkItem('image', f)),
  };
  jobs.set(job.id, job); emit();
  await persist(job);
  run(job);
  return job.id;
}

/** Office admin / BSO campaign: upload photos, THEN create the campaign (idempotent requestId). Resolves when finished or paused. */
export async function enqueueManagedCreate({ userId, label, requestId, payload, images, redirectTo }) {
  const job = {
    id: newId(), kind: 'managed', userId, label: label || 'New campaign', status: 'queued', createdAt: Date.now(),
    requestId, payload, redirectTo, items: images.map((f) => mkItem('image', f)),
  };
  jobs.set(job.id, job); emit();
  await persist(job);
  run(job);
  return waitFor(job);
}

export function resumeJob(id) { const j = jobs.get(id); if (j && j.status !== 'uploading') run(j); return j ? waitFor(j) : null; }

export async function dismissJob(id) { jobs.delete(id); emit(); await unpersist(id); }

/** Load unfinished jobs saved by an earlier session; they are shown as paused until the user presses Resume. */
export async function restoreJobs() {
  if (restored) return; restored = true;
  const all = await tx('readonly', (s) => s.getAll());
  for (const j of (Array.isArray(all) ? all : [])) {
    if (jobs.has(j.id) || j.status === 'complete') continue;
    j.status = 'interrupted';
    j.message = 'This upload was paused when the page closed. Press Resume to send the remaining files.';
    jobs.set(j.id, j);
  }
  emit();
}
