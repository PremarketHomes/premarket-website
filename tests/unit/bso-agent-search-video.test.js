import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { filterAgents, agentLabel } from '../../src/app/utils/agentSearch';
import { isOwnUploadedVideoUrl } from '../../src/app/api/services/managedCampaignService';
import * as M from '../../src/app/utils/mediaUploadManager';

const read = (p) => readFileSync(p, 'utf8');
const agents = [
  { uid: 'a1', name: 'Brooke Campbell-Rawson', email: 'brooke@hph.example' },
  { uid: 'a2', name: 'Isabella Cross-Winston', email: 'bella@hph.example' },
  { uid: 'a3', name: 'Phil Chillemi', email: 'phil@hph.example' },
  { uid: 'a4', name: 'Scott Rigby', email: 'scott@hph.example', loginStatus: 'invited' },
  { uid: 'a5', name: 'Chloé Philips', email: 'chloe@hph.example' },
];
const ids = (q) => filterAgents(agents, q).map((a) => a.uid);

describe('selling-agent search', () => {
  it('is case-insensitive and matches partial names', () => {
    expect(ids('phil')).toEqual(['a3', 'a5']); // name starting with it first
    expect(ids('PHIL')).toEqual(['a3', 'a5']);
    expect(ids('chil')).toEqual(['a3']);
    expect(ids('rig')).toEqual(['a4']);
  });
  it('every word typed must match, in any order; accents and extra spaces are ignored', () => {
    expect(ids('phil chi')).toEqual(['a3']);
    expect(ids('chillemi  phil ')).toEqual(['a3']);
    expect(ids('chloe')).toEqual(['a5']);
  });
  it('empty search lists everyone (office-scoped list as given); no match gives an empty list', () => {
    expect(ids('')).toEqual(['a1', 'a2', 'a3', 'a4', 'a5']);
    expect(ids('zzz')).toEqual([]);
    expect(filterAgents(undefined, 'x')).toEqual([]);
  });
  it('label shows invited agents as not logged in yet', () => {
    expect(agentLabel(agents[3])).toBe('Scott Rigby (not logged in yet)');
    expect(agentLabel(agents[2])).toBe('Phil Chillemi');
  });
});

describe('the server accepts only the BSO\'s own uploaded video for this campaign', () => {
  const B = 'premarket-homes.firebasestorage.app';
  const url = (obj, bucket = B, host = 'firebasestorage.googleapis.com') => `https://${host}/v0/b/${bucket}/o/${encodeURIComponent(obj)}?alt=media&token=abc`;
  const ok = (u, actorUid = 'bso1', propertyId = 'p1') => isOwnUploadedVideoUrl(u, { actorUid, propertyId, bucket: B });
  it('accepts propertyVideos/{actor}/{propertyId}-… in this project\'s bucket', () => {
    expect(ok(url('propertyVideos/bso1/p1-abc-walkthrough.mp4'))).toBe(true);
  });
  it('rejects other uploaders, other campaigns, other buckets, other hosts, traversal and non-https', () => {
    expect(ok(url('propertyVideos/agent9/p1-abc.mp4'))).toBe(false);
    expect(ok(url('propertyVideos/bso1/p2-abc.mp4'))).toBe(false);
    expect(ok(url('propertyVideos/bso1/p1-abc.mp4', 'evil-bucket'))).toBe(false);
    expect(ok(url('propertyVideos/bso1/p1-abc.mp4', B, 'evil.example.com'))).toBe(false);
    expect(ok(url('propertyVideos/bso1/p1-../../x.mp4'))).toBe(false);
    expect(ok(url('propertyVideos/bso1/p1-a/b.mp4'))).toBe(false);
    expect(ok(url('propertyImages/bso1/p1-abc.jpg'))).toBe(false);
    expect(ok(url('propertyVideos/bso1/p1-abc.mp4').replace('https:', 'http:'))).toBe(false);
    expect(ok('not a url')).toBe(false);
    expect(ok(null)).toBe(false);
  });
});

describe('managed video upload job (background, resumable)', () => {
  let calls;
  beforeEach(() => {
    M.__resetForTests();
    calls = { upload: [], patches: [], setVideo: [] };
    M.__setDepsForTests({
      currentUid: () => 'bso1',
      uploadFile: async (path) => { calls.upload.push(path); return `https://firebasestorage.googleapis.com/v0/b/b/o/${encodeURIComponent(path)}?alt=media`; },
      updateProperty: async (id, patch) => { calls.patches.push({ id, patch }); },
      apiUpload: async () => { throw new Error('photos path must not be used for video'); },
      apiSetManagedVideo: async (propertyId, url) => { calls.setVideo.push({ propertyId, url }); return { changed: true }; },
      apiAttachManagedMedia: async () => ({}), apiCreateManaged: async () => ({}),
      triggerCompress: () => {}, convertHeic: async (f) => f, sleep: async () => {},
    });
  });
  const idle = async (id) => { for (let i = 0; i < 200; i++) { const j = M.getJobs().find((x) => x.id === id); if (j && !['uploading', 'queued'].includes(j.status)) return j; await new Promise((r) => setTimeout(r, 0)); } throw new Error('never settled'); };
  it('uploads to Storage like an agent\'s video, then attaches through the server — never writes the property directly', async () => {
    const id = await M.enqueueManagedVideoUpload({ propertyId: 'p1', userId: 'bso1', video: { name: 'walk through.mp4', type: 'video/mp4', size: 100 } });
    const j = await idle(id);
    expect(j.status).toBe('complete');
    expect(j.message).toBe('Video added.');
    expect(calls.upload).toHaveLength(1);
    expect(calls.upload[0]).toMatch(/^propertyVideos\/bso1\/p1-[A-Za-z0-9-]+-walk_through\.mp4$/);
    expect(calls.setVideo).toEqual([{ propertyId: 'p1', url: expect.stringContaining(encodeURIComponent('propertyVideos/bso1/p1-')) }]);
    expect(calls.patches).toHaveLength(0);
  });
});

describe('page wiring (BSO only; office admin and agent flows unchanged)', () => {
  const add = read('src/app/dashboard/add/page.js');
  const edit = read('src/app/dashboard/edit/[id]/page.js');
  it('BSOs get the searchable selector; office admins keep the dropdown (with "Myself")', () => {
    expect(add).toContain('{hasAssignable && isBsoCreator ? (\n                      <AgentCombobox');
    expect(add).toContain('agents={assignable.agents}');
    expect(add).toContain("isBsoCreator ? 'Choose the selling agent…' : 'Myself'");
    const combo = read('src/app/dashboard/components/AgentCombobox.js');
    for (const s of ['role="combobox"', 'role="listbox"', "e.key === 'ArrowDown'", "e.key === 'Enter'", "e.key === 'Escape'", 'No agents match', 'onMouseDown={(e) => e.preventDefault()}']) expect(combo).toContain(s);
  });
  it('the new BSO explanation replaces the old paragraph; SELLING AGENT heading kept', () => {
    expect(add).toContain("Search and select the agent you're creating this campaign for. The selected agent will appear on the property listing. You'll manage the campaign on their behalf.");
    expect(add).not.toContain('you manage it from your Dashboard');
    expect(add).toContain('>Selling agent</label>');
  });
  it('a BSO can include a video when creating; it is attached after the campaign exists. Office admins: unchanged', () => {
    expect(add).toContain('if (video && !isBsoCreator) {');
    expect(add).toContain('await enqueueManagedVideoUpload({ propertyId: job.propertyId, userId: user.uid');
  });
  it('the managing BSO can add, replace or remove the video when editing; office admins still photos only', () => {
    expect(edit).toContain("if (managerMode && manageRole !== 'bso') {");
    expect(edit).toContain('enqueueManagedVideoUpload({ propertyId, userId: user.uid');
    expect(edit).toContain('} else if (savedVideoUrl && !existingVideoUrl) {');
    expect(read('src/app/api/properties/[id]/managed/video/route.js')).toContain('setManagedVideo(db, { actorUid, propertyId');
  });
});
