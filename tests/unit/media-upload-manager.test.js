import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as M from '../../src/app/utils/mediaUploadManager';

const file = (name) => ({ name, type: 'image/jpeg', size: 10 });
let d, calls, failOn;
beforeEach(() => {
  M.__resetForTests();
  calls = { upload: [], patches: [], compress: 0, created: [] };
  failOn = new Set();
  d = {
    currentUid: () => 'u1',
    uploadFile: async (path) => { calls.upload.push(path); if ([...failOn].some((n) => path.endsWith(`-${n}`))) throw new Error('network'); return `https://cdn/${path}`; },
    updateProperty: async (id, patch) => { calls.patches.push({ id, patch }); },
    apiUpload: async (f) => { calls.upload.push(f.name); if (failOn.has(f.name)) throw new Error('network'); return `https://bunny/${f.name}`; },
    apiAttachManagedMedia: async (propertyId, urls) => { calls.attached = [...(calls.attached || []), { propertyId, urls }]; if (failOn.has('ATTACH')) throw new Error('network'); return { added: urls.length }; },
    apiCreateManaged: async (body) => { calls.created.push(body); if (failOn.has('CREATE')) { const e = new Error('Not allowed'); e.status = 403; throw e; } return { propertyId: 'newprop' }; },
    triggerCompress: () => { calls.compress++; },
    convertHeic: async (f) => f,
    sleep: async () => {},
  };
  M.__setDepsForTests(d);
});
const idle = async (id) => { for (let i = 0; i < 200; i++) { const j = M.getJobs().find((x) => x.id === id); if (j && !['uploading', 'queued'].includes(j.status)) return j; await new Promise((r) => setTimeout(r, 0)); } throw new Error('never settled'); };
const completeWrites = () => calls.patches.filter((p) => p.patch['imageUploadProgress.inProgress'] === false);

describe('property media uploads', () => {
  it('uploads every file, attaches each to the right property, and marks complete only after the last one', async () => {
    const id = await M.enqueuePropertyUpload({ propertyId: 'propA', userId: 'u1', label: 'x', files: [file('a.jpg'), file('b.jpg'), file('c.jpg')] });
    const j = await idle(id);
    expect(j.status).toBe('complete');
    expect(calls.upload).toHaveLength(3);
    expect(calls.patches.every((p) => p.id === 'propA')).toBe(true);
    expect(calls.patches.filter((p) => p.patch['imageUrls+']).map((p) => p.patch['imageUrls+'])).toHaveLength(3);
    const done = completeWrites();
    expect(done).toHaveLength(1);
    expect(calls.patches.indexOf(done[0])).toBe(calls.patches.length - 1); // after all attachments
    expect(calls.compress).toBe(1);
  });

  it('a failing file pauses the job (never "complete"), keeps finished files, and Resume sends only the rest', async () => {
    failOn.add('b.jpg');
    const id = await M.enqueuePropertyUpload({ propertyId: 'propA', userId: 'u1', files: [file('a.jpg'), file('b.jpg'), file('c.jpg')] });
    let j = await idle(id);
    expect(j.status).toBe('interrupted');
    expect(j.done).toBe(1); expect(j.remaining).toBe(2);
    expect(completeWrites()).toHaveLength(0);
    expect(calls.patches.some((p) => p.patch['imageUploadProgress.interrupted'] === true)).toBe(true);
    expect(calls.compress).toBe(0);
    const uploadsBefore = calls.upload.filter((p) => /a\.jpg/.test(p)).length;

    failOn.clear();
    await M.resumeJob(id);
    j = await idle(id);
    expect(j.status).toBe('complete');
    expect(calls.upload.filter((p) => /a\.jpg/.test(p)).length).toBe(uploadsBefore); // finished file never re-sent
    expect(completeWrites()).toHaveLength(1);
    const attached = calls.patches.filter((p) => p.patch['imageUrls+']).map((p) => p.patch['imageUrls+']);
    expect(new Set(attached).size).toBe(3); // each attached once
  });

  it('retries a file automatically to the SAME storage path (no duplicate objects)', async () => {
    let n = 0; const orig = d.uploadFile;
    d.uploadFile = async (path, ...r) => { n++; if (n === 1) throw new Error('blip'); return orig(path, ...r); };
    const id = await M.enqueuePropertyUpload({ propertyId: 'propA', userId: 'u1', files: [file('a.jpg')] });
    expect((await idle(id)).status).toBe('complete');
    expect(calls.upload).toHaveLength(1);
    expect(calls.upload[0]).toMatch(/^propertyImages\/u1\/propA-[^/]+$/);
  });

  it('a file that cannot be attached to the property is not counted as done', async () => {
    d.updateProperty = async (id, patch) => { if (patch['imageUrls+']) throw new Error('rules'); };
    const id = await M.enqueuePropertyUpload({ propertyId: 'propA', userId: 'u1', files: [file('a.jpg')] });
    const j = await idle(id);
    expect(j.status).toBe('interrupted'); expect(j.done).toBe(0);
  });

  it('does not run for a different signed-in user', async () => {
    d.currentUid = () => 'someone-else';
    const id = await M.enqueuePropertyUpload({ propertyId: 'propA', userId: 'u1', files: [file('a.jpg')] });
    expect((await idle(id)).status).toBe('interrupted');
    expect(calls.upload).toHaveLength(0);
  });

  it('a video failure also keeps the media incomplete', async () => {
    failOn.add('v.mp4');
    const id = await M.enqueuePropertyUpload({ propertyId: 'propA', userId: 'u1', files: [file('a.jpg')], video: { name: 'v.mp4', type: 'video/mp4', size: 5 } });
    expect((await idle(id)).status).toBe('interrupted');
    expect(completeWrites()).toHaveLength(0);
  });
});

describe('managed campaign creation', () => {
  const payload = { ownerUid: 'agent1', acceptTerms: true, property: { address: '1 A St' } };
  it('creates the campaign only after every photo uploaded, keeping order and pre-existing URLs', async () => {
    const job = await M.enqueueManagedCreate({ userId: 'u1', requestId: 'req-1', payload, images: ['https://old/1.jpg', file('a.jpg'), file('b.jpg')] });
    expect(job.status).toBe('complete');
    expect(calls.created).toHaveLength(1);
    expect(calls.created[0].requestId).toBe('req-1');
    expect(calls.created[0].property.imageUrls).toEqual(['https://old/1.jpg', 'https://bunny/a.jpg', 'https://bunny/b.jpg']);
  });

  it('a failed photo creates nothing; Resume finishes it once with the same requestId', async () => {
    failOn.add('b.jpg');
    const job = await M.enqueueManagedCreate({ userId: 'u1', requestId: 'req-2', payload, images: [file('a.jpg'), file('b.jpg')] });
    expect(job.status).toBe('interrupted');
    expect(calls.created).toHaveLength(0);
    failOn.clear();
    const after = await M.resumeJob(job.id);
    expect(after.status).toBe('complete');
    expect(calls.created).toHaveLength(1);
    expect(calls.created[0].requestId).toBe('req-2');
    expect(calls.upload.filter((n) => n === 'a.jpg')).toHaveLength(1);
  });

  it('a server refusal (403) is a final error, not retried', async () => {
    failOn.add('CREATE');
    const job = await M.enqueueManagedCreate({ userId: 'u1', requestId: 'req-3', payload, images: [file('a.jpg')] });
    expect(job.status).toBe('error');
    expect(calls.created).toHaveLength(1);
  });
});

describe('photos added by a campaign manager (BSO / office admin)', () => {
  it('uploads through the server, then attaches all photos through the server in one call; never writes the property directly', async () => {
    const id = await M.enqueueManagedMediaUpload({ propertyId: 'm_1', userId: 'u1', label: 'Photos', files: [file('a.jpg'), file('b.jpg')] });
    const j = await idle(id);
    expect(j.status).toBe('complete');
    expect(calls.upload).toEqual(['a.jpg', 'b.jpg']);
    expect(calls.attached).toEqual([{ propertyId: 'm_1', urls: ['https://bunny/a.jpg', 'https://bunny/b.jpg'] }]);
    expect(calls.patches).toHaveLength(0); // the manager cannot (and does not) write the property from the browser
    expect(calls.compress).toBe(1);
  });
  it('a failed photo pauses the job; Resume re-sends only the unfinished photo and attaches each URL (server ignores repeats)', async () => {
    failOn.add('b.jpg');
    const id = await M.enqueueManagedMediaUpload({ propertyId: 'm_1', userId: 'u1', files: [file('a.jpg'), file('b.jpg')] });
    let j = await idle(id);
    expect(j.status).toBe('interrupted');
    expect(calls.attached).toBeUndefined();
    failOn.clear();
    await M.resumeJob(id);
    j = await idle(id);
    expect(j.status).toBe('complete');
    expect(calls.upload.filter((n) => n === 'a.jpg')).toHaveLength(1);
    expect(calls.attached).toEqual([{ propertyId: 'm_1', urls: ['https://bunny/a.jpg', 'https://bunny/b.jpg'] }]);
  });
  it('an attach failure is retried and then paused for Resume, without re-uploading finished photos', async () => {
    failOn.add('ATTACH');
    const id = await M.enqueueManagedMediaUpload({ propertyId: 'm_1', userId: 'u1', files: [file('a.jpg')] });
    let j = await idle(id);
    expect(j.status).toBe('interrupted');
    failOn.clear();
    await M.resumeJob(id);
    j = await idle(id);
    expect(j.status).toBe('complete');
    expect(calls.upload).toEqual(['a.jpg']);
  });
});
