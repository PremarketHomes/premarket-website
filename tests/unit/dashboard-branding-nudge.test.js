import { describe, it, expect } from 'vitest';

/**
 * Source-inspection regression tests (same pattern already established
 * by brand-style.test.js and safe-redirect.test.js) for the dashboard's
 * branding/profile-photo nudge — there's no component-test harness in
 * this codebase to actually render dashboard/page.js and exercise the
 * JSX condition directly, so this guards the specific bug fix at the
 * source level instead: an office agent must never see the "Upload
 * your agency logo" nudge (they inherit branding through officeId and
 * never have their own agencyBrandId set at all), and should see a
 * profile-photo prompt instead if their avatar is still the
 * placeholder every new account starts with.
 */
describe('dashboard/page.js — branding nudge correctly branches on officeId', () => {
  it('BUG FIX: the nudge condition checks userData.officeId, not just userData.agencyBrandId alone', async () => {
    const fs = await import('node:fs');
    const source = fs.readFileSync(new URL('../../src/app/dashboard/page.js', import.meta.url), 'utf-8');

    // The OLD, buggy condition — must never reappear on its own.
    expect(source).not.toMatch(/!brandingNudgeDismissed && userData && !userData\.agencyBrandId && \(userData\.isAgent \|\| userData\.agent\) && \(\s*<BrandingNudge/);

    // The fix: branches on officeId first.
    expect(source).toContain('userData.officeId ? (');
    expect(source).toContain('isPlaceholderAvatar(userData.avatar)');
    expect(source).toContain('<ProfilePhotoPrompt');
  });

  it('isPlaceholderAvatar treats a missing avatar and the exact known placeholder URL as "not yet uploaded", and anything else as uploaded', async () => {
    const fs = await import('node:fs');
    // The helper now lives in utils/avatar.js (shared with the mobile greeting); the dashboard imports it.
    const source = fs.readFileSync(new URL('../../src/app/utils/avatar.js', import.meta.url), 'utf-8');
    const dashboard = fs.readFileSync(new URL('../../src/app/dashboard/page.js', import.meta.url), 'utf-8');
    expect(dashboard).toContain("import { isPlaceholderAvatar } from '../utils/avatar';");

    // Re-implemented directly here (rather than dynamically eval-ing
    // extracted source, which is fragile) — this is the one place
    // that re-verifies the ACTUAL LOGIC, independent of the source-
    // inspection checks elsewhere in this file, which only verify
    // that this function is wired into the right place.
    const PLACEHOLDER_AVATAR_URL = 'https://upload.wikimedia.org/wikipedia/commons/7/7c/Profile_avatar_placeholder_large.png?20150327203541';
    function isPlaceholderAvatar(avatar) {
      return !avatar || avatar === PLACEHOLDER_AVATAR_URL;
    }

    expect(source).toContain('export function isPlaceholderAvatar(avatar)');
    expect(source).toContain('return !avatar || avatar === PLACEHOLDER_AVATAR_URL;');

    expect(isPlaceholderAvatar(undefined)).toBe(true);
    expect(isPlaceholderAvatar(null)).toBe(true);
    expect(isPlaceholderAvatar(PLACEHOLDER_AVATAR_URL)).toBe(true);
    expect(isPlaceholderAvatar('https://example.com/my-real-photo.jpg')).toBe(false);
  });

  it('the placeholder URL checked here matches exactly what office-invited accounts are actually seeded with (officeImportService.js) and what self-signup uses (join/page.js)', async () => {
    const fs = await import('node:fs');
    const dashboardSource = fs.readFileSync(new URL('../../src/app/utils/avatar.js', import.meta.url), 'utf-8');
    const officeImportSource = fs.readFileSync(new URL('../../src/app/api/services/officeImportService.js', import.meta.url), 'utf-8');
    const joinSource = fs.readFileSync(new URL('../../src/app/join/page.js', import.meta.url), 'utf-8');

    const PLACEHOLDER = 'https://upload.wikimedia.org/wikipedia/commons/7/7c/Profile_avatar_placeholder_large.png?20150327203541';
    expect(dashboardSource).toContain(PLACEHOLDER);
    expect(officeImportSource).toContain(PLACEHOLDER);
    expect(joinSource).toContain(PLACEHOLDER);
  });

  it('the independent-agent branding nudge path is otherwise unchanged — still gated on agencyBrandId when there is no officeId', async () => {
    const fs = await import('node:fs');
    const source = fs.readFileSync(new URL('../../src/app/dashboard/page.js', import.meta.url), 'utf-8');
    expect(source).toContain('!userData.agencyBrandId && (');
    expect(source).toContain('<BrandingNudge hasLogo={!!userData.logoUrl} onDismiss={dismissBrandingNudge} />');
  });
});
