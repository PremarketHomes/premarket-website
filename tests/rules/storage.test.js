import { describe, it, beforeAll, afterAll, beforeEach } from 'vitest';
import { initializeTestEnvironment, assertSucceeds, assertFails } from '@firebase/rules-unit-testing';
import { ref, uploadBytes, getBytes, getMetadata, deleteObject, listAll, updateMetadata } from 'firebase/storage';
import { readFileSync } from 'fs';
import { resolve } from 'path';

// Storage rules: public download of individual files in the listing-media folders only, no listing, and browser uploads only into
// the signed-in user's own propertyImages/{uid} or propertyVideos/{uid} folder.
let env;
const bytes = (n = 16) => new Uint8Array(n);
const jpeg = { contentType: 'image/jpeg' };

const storageFor = (uid) => (uid ? env.authenticatedContext(uid) : env.unauthenticatedContext()).storage();
const seed = (path, data = bytes(), meta = jpeg) =>
  env.withSecurityRulesDisabled((ctx) => uploadBytes(ref(ctx.storage(), path), data, meta));

beforeAll(async () => {
  env = await initializeTestEnvironment({
    projectId: 'premarket-rules-test',
    storage: { rules: readFileSync(resolve(__dirname, '../../storage.rules'), 'utf8'), host: '127.0.0.1', port: 9199 },
  });
});
afterAll(async () => { await env?.cleanup(); });
beforeEach(async () => { await env.clearStorage(); });

describe('public downloads (only the listing-media folders)', () => {
  it.each([
    'propertyImages/agentA/123-front.jpg',
    'propertyImages/legacy-flat.jpg',
    'property_images/legacy.jpg',
    'property_images/prop1/nested/legacy.jpg',
    'propertyVideos/agentA/prop-1-walkthrough.mov',
    'avatars/agentA.jpg',
    'avatarActors/actor1.png',
    'aiVideos/job1/final.mp4',
    'videos/tour.mp4',
    'storyImages/story1.png',
  ])('anyone can download %s', async (path) => {
    await seed(path);
    await assertSucceeds(getBytes(ref(storageFor(null), path)));
    await assertSucceeds(getMetadata(ref(storageFor('someoneElse'), path)));
  });

  // Private or unused material: documents, chat attachments, temp files, app assets. Denied to everyone,
  // signed in or not, for both the file and its metadata (metadata would otherwise reveal the download token).
  it.each([
    'JoshLouiseApplication.zip',
    'Untitled video - Made with Clipchamp.mp4',
    'PR/Press Release 1.0.pdf',
    'chatrooms/room1_userA/files/document.pdf',
    'chatrooms/room1_userA/images/photo.jpg',
    'temp/123.jpg',
    'app/addProperty.mp4',
    'emails/header.png',
    'uploads/x.jpg',
    'images/x.png',
    'agents/sneakpeek.png',
    'qrcodes/x.png',
    'stories/x.png',
    'FCMImages/x.png',
    'musicBackgrounds/x.mp3',
    'audio/x.mp3',
    'property_audio/x.mp3',
    'property_videos/x',
    'propertyImagesX/agentA/1.jpg',
  ])('nobody can download %s', async (path) => {
    await seed(path);
    await assertFails(getBytes(ref(storageFor(null), path)));
    await assertFails(getMetadata(ref(storageFor(null), path)));
    await assertFails(getBytes(ref(storageFor('someoneSignedIn'), path)));
    await assertFails(getMetadata(ref(storageFor('someoneSignedIn'), path)));
  });

  it('nobody can list a folder or the bucket', async () => {
    await seed('propertyImages/agentA/1.jpg');
    await assertFails(listAll(ref(storageFor(null), 'propertyImages')));
    await assertFails(listAll(ref(storageFor('agentA'), 'propertyImages/agentA')));
    await assertFails(listAll(ref(storageFor('agentA'), '')));
  });
});

describe('authorised uploads (own folder)', () => {
  it('owner uploads a JPEG, HEIC, PNG and a typeless photo', async () => {
    const s = storageFor('agentA');
    await assertSucceeds(uploadBytes(ref(s, 'propertyImages/agentA/1-front.jpg'), bytes(), jpeg));
    await assertSucceeds(uploadBytes(ref(s, 'propertyImages/agentA/2-back.heic'), bytes(), { contentType: 'image/heic' }));
    await assertSucceeds(uploadBytes(ref(s, 'propertyImages/agentA/3-pool.png'), bytes(), { contentType: 'image/png' }));
    await assertSucceeds(uploadBytes(ref(s, 'propertyImages/agentA/4-noext'), bytes(), { contentType: 'application/octet-stream' }));
  });

  it('owner uploads a campaign video (mov / mp4)', async () => {
    const s = storageFor('agentA');
    await assertSucceeds(uploadBytes(ref(s, 'propertyVideos/agentA/prop-1-tour.mov'), bytes(), { contentType: 'video/quicktime' }));
    await assertSucceeds(uploadBytes(ref(s, 'propertyVideos/agentA/prop-1-tour.mp4'), bytes(), { contentType: 'video/mp4' }));
  });

  it('an office admin (BSO) uploads into their own folder, as the upload manager does', async () => {
    await assertSucceeds(uploadBytes(ref(storageFor('bsoAdmin'), 'propertyImages/bsoAdmin/prop9-img1-a.jpg'), bytes(), jpeg));
  });

  it('a photo just under the 50 MB limit is accepted', async () => {
    await assertSucceeds(uploadBytes(ref(storageFor('agentA'), 'propertyImages/agentA/big.jpg'), bytes(50 * 1024 * 1024), jpeg));
  });
});

describe('unauthorised uploads', () => {
  it('signed-out visitors cannot upload anywhere', async () => {
    const s = storageFor(null);
    await assertFails(uploadBytes(ref(s, 'propertyImages/agentA/x.jpg'), bytes(), jpeg));
    await assertFails(uploadBytes(ref(s, 'propertyVideos/agentA/x.mp4'), bytes(), { contentType: 'video/mp4' }));
    await assertFails(uploadBytes(ref(s, 'anything.jpg'), bytes(), jpeg));
  });

  it("a signed-in user cannot upload into someone else's folder", async () => {
    const s = storageFor('agentB');
    await assertFails(uploadBytes(ref(s, 'propertyImages/agentA/x.jpg'), bytes(), jpeg));
    await assertFails(uploadBytes(ref(s, 'propertyVideos/agentA/x.mp4'), bytes(), { contentType: 'video/mp4' }));
  });

  it('a signed-in user cannot upload outside the two website folders', async () => {
    const s = storageFor('agentA');
    for (const path of ['avatars/agentA.jpg', 'temp/agentA/x.jpg', 'aiVideos/x.mp4', 'root.jpg', 'propertyImages/agentA/sub/deeper.jpg']) {
      await assertFails(uploadBytes(ref(s, path), bytes(), jpeg));
    }
  });

  it('wrong file types are rejected', async () => {
    const s = storageFor('agentA');
    await assertFails(uploadBytes(ref(s, 'propertyImages/agentA/page.html'), bytes(), { contentType: 'text/html' }));
    await assertFails(uploadBytes(ref(s, 'propertyImages/agentA/clip.mp4'), bytes(), { contentType: 'video/mp4' }));
    await assertFails(uploadBytes(ref(s, 'propertyVideos/agentA/photo.jpg'), bytes(), jpeg));
    await assertFails(uploadBytes(ref(s, 'propertyVideos/agentA/app.zip'), bytes(), { contentType: 'application/zip' }));
  });

  it('a photo over 50 MB is rejected', async () => {
    await assertFails(uploadBytes(ref(storageFor('agentA'), 'propertyImages/agentA/huge.jpg'), bytes(50 * 1024 * 1024 + 1), jpeg));
  });
});

describe('overwrites', () => {
  const path = 'propertyImages/agentA/prop1-img1-front.jpg';

  it('the owner can overwrite their own file (an upload retry)', async () => {
    await seed(path);
    await assertSucceeds(uploadBytes(ref(storageFor('agentA'), path), bytes(32), jpeg));
  });

  it("other users and signed-out visitors cannot overwrite or re-tag the owner's file", async () => {
    await seed(path);
    await assertFails(uploadBytes(ref(storageFor('agentB'), path), bytes(32), jpeg));
    await assertFails(uploadBytes(ref(storageFor(null), path), bytes(32), jpeg));
    await assertFails(updateMetadata(ref(storageFor('agentB'), path), { contentType: 'text/html' }));
  });

  it('existing files outside the website folders cannot be overwritten', async () => {
    await seed('avatars/agentA.jpg');
    await assertFails(uploadBytes(ref(storageFor('agentA'), 'avatars/agentA.jpg'), bytes(32), jpeg));
  });
});

describe('deletions', () => {
  it('no browser user can delete files, including their own (only server code deletes)', async () => {
    await seed('propertyImages/agentA/1.jpg');
    await seed('propertyVideos/agentA/1.mp4', bytes(), { contentType: 'video/mp4' });
    await seed('avatars/agentA.jpg');
    await assertFails(deleteObject(ref(storageFor('agentA'), 'propertyImages/agentA/1.jpg')));
    await assertFails(deleteObject(ref(storageFor('agentB'), 'propertyImages/agentA/1.jpg')));
    await assertFails(deleteObject(ref(storageFor(null), 'propertyVideos/agentA/1.mp4')));
    await assertFails(deleteObject(ref(storageFor('agentA'), 'avatars/agentA.jpg')));
  });

  it('server code (Admin SDK, rules bypassed) can still delete', async () => {
    await seed('propertyImages/agentA/1.jpg');
    await assertSucceeds(env.withSecurityRulesDisabled((ctx) => deleteObject(ref(ctx.storage(), 'propertyImages/agentA/1.jpg'))));
  });
});
