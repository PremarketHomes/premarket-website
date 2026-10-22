import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';

const getDocMock = vi.fn();
vi.mock('firebase/firestore', () => ({ doc: (_db, col, id) => ({ col, id }), getDoc: (...a) => getDocMock(...a) }));
vi.mock('../../src/app/firebase/clientApp', () => ({ db: {} }));

const { fetchUserData } = await import('../../src/app/context/fetchUserData');

const snap = (data) => ({ exists: () => !!data, id: 'u1', data: () => data });

describe('fetchUserData (backs AuthContext.refreshUserData)', () => {
  beforeEach(() => getDocMock.mockReset());

  it('picks up isOfficeAdmin/officeId set server-side after the first read', async () => {
    getDocMock.mockResolvedValueOnce(snap({ email: 'a@b.c' }));
    expect((await fetchUserData('u1')).isOfficeAdmin).toBeUndefined();

    getDocMock.mockResolvedValueOnce(snap({ email: 'a@b.c', officeId: 'o1', isOfficeAdmin: true }));
    expect(await fetchUserData('u1')).toMatchObject({ id: 'u1', officeId: 'o1', isOfficeAdmin: true });
  });

  it('returns null when the user doc does not exist', async () => {
    getDocMock.mockResolvedValueOnce(snap(null));
    expect(await fetchUserData('u1')).toBeNull();
  });
});

describe('office setup flows refresh userData before navigating', () => {
  it('join page awaits refreshUserData before pushing to /dashboard/office', () => {
    const src = readFileSync('src/app/join/page.js', 'utf8');
    expect(src.indexOf('await refreshUserData()')).toBeGreaterThan(-1);
    expect(src.indexOf('await refreshUserData()')).toBeLessThan(src.indexOf("router.push('/dashboard/office');"));
  });

  it('office setup recovery awaits refreshUserData before reloading', () => {
    const src = readFileSync('src/app/dashboard/office/page.js', 'utf8');
    expect(src.indexOf('await refreshUserData()')).toBeLessThan(src.indexOf('onCreated();'));
  });

  it('both flows fall back to a full page load (not a re-submit) when the refresh fails', () => {
    for (const f of ['src/app/join/page.js', 'src/app/dashboard/office/page.js']) {
      const src = readFileSync(f, 'utf8');
      expect(src).toMatch(/if \(!\(await refreshUserData\(\)\)\) \{\s*window\.location\.assign\('\/dashboard\/office'\);/);
    }
  });
});
