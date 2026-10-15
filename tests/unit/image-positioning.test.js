import { describe, it, expect } from 'vitest';
import fs from 'node:fs';

function read(relPath) {
  return fs.readFileSync(new URL(relPath, import.meta.url), 'utf-8');
}

describe('ImagePositioner.js — reusable control', () => {
  const source = read('../../src/app/components/ImagePositioner.js');

  it('is built on react-easy-crop, not a hand-rolled drag/zoom implementation', () => {
    expect(source).toContain("from 'react-easy-crop'");
  });

  it('hides the zoom slider when minZoom === maxZoom, for the focal-point-only use case', () => {
    expect(source).toContain('{minZoom < maxZoom && (');
  });

  it('never calls onSave without a completed crop area', () => {
    const fnStart = source.indexOf('const handleSave');
    const fnBody = source.slice(fnStart, fnStart + 200);
    expect(fnBody).toContain('if (!croppedArea || !croppedAreaPixels) return;');
  });

  it('exposes a Reset control that returns both position and zoom to their defaults', () => {
    const fnStart = source.indexOf('const handleReset');
    const fnBody = source.slice(fnStart, fnStart + 200);
    expect(fnBody).toContain('setCrop({ x: 0, y: 0 })');
    expect(fnBody).toContain('setZoom(1)');
  });

  it('defaults minZoom to 1 so the image can never be zoomed out to show blank space', () => {
    expect(source).toContain('minZoom = 1');
  });

  it('renders a caller-supplied error message without closing or disabling the control', () => {
    expect(source).toContain('error = \'\'');
    expect(source).toContain('{error && (');
  });
});

describe('SmartPropertyImage.js — optional focal point, additive only', () => {
  const source = read('../../src/app/components/property-page/SmartPropertyImage.js');

  it('accepts an objectPosition prop without a required default', () => {
    expect(source).toContain('objectPosition }');
  });

  it('only applies it in object-cover mode, never once the letterbox/object-contain fallback kicks in', () => {
    expect(source).toContain('!contain && objectPosition');
  });
});

describe('PropertyHero.js — passes the stored focal point through', () => {
  it('forwards heroFocalPoint to SmartPropertyImage as objectPosition', () => {
    const source = read('../../src/app/components/property-page/PropertyHero.js');
    expect(source).toContain('heroFocalPoint,');
    expect(source).toContain('objectPosition={heroFocalPoint}');
  });
});

describe('PropertyPageClient.js — reads heroFocalPoint from the property, falls back cleanly', () => {
  it('passes undefined (not null, not a crash) when no property or no focal point exists', () => {
    const source = read('../../src/app/components/PropertyPageClient.js');
    expect(source).toContain('heroFocalPoint={property?.heroFocalPoint || undefined}');
  });
});

describe('dashboard/add and edit pages — focal point lifecycle', () => {
  const addSource = read('../../src/app/dashboard/add/page.js');
  const editSource = read('../../src/app/dashboard/edit/[id]/page.js');

  it('both pages clear heroFocalPoint when the cover photo (index 0) is removed', () => {
    expect(addSource).toContain("if (index === 0) setHeroFocalPoint(null);");
    expect(editSource).toContain("if (index === 0) setHeroFocalPoint(null);");
  });

  it('both pages clear heroFocalPoint when reordering moves a different photo into/out of the cover slot', () => {
    expect(addSource).toContain("if (fromIndex === 0 || toIndex === 0) setHeroFocalPoint(null);");
    expect(editSource).toContain("if (fromIndex === 0 || toIndex === 0) setHeroFocalPoint(null);");
  });

  it('both pages lock the positioner to zoom=1 for the cover photo — repositioning only, never a crop/zoom bake', () => {
    expect(addSource).toMatch(/minZoom=\{1\}\s*\n\s*maxZoom=\{1\}/);
    expect(editSource).toMatch(/minZoom=\{1\}\s*\n\s*maxZoom=\{1\}/);
  });

  it('both pages include heroFocalPoint in the property save payload only when set', () => {
    expect(addSource).toContain('...(heroFocalPoint ? { heroFocalPoint } : {})');
    expect(editSource).toContain('heroFocalPoint: heroFocalPoint || null');
  });

  it('the edit page restores an existing heroFocalPoint when loading a property for editing', () => {
    expect(editSource).toContain('setHeroFocalPoint(p.heroFocalPoint || null);');
  });
});

describe('dashboard/settings page — avatar and logo bake via the existing upload pipeline, unchanged', () => {
  const source = read('../../src/app/dashboard/settings/page.js');

  it('the positioner intercepts file selection — the raw file never becomes avatarFile/logoFile directly', () => {
    const avatarFnStart = source.indexOf('const handleAvatarChange');
    const avatarFnBody = source.slice(avatarFnStart, avatarFnStart + 300);
    expect(avatarFnBody).not.toContain('setAvatarFile(file)');
    expect(avatarFnBody).toContain("setPositionerTarget('avatar')");
  });

  it('bakes the avatar as a square, round-cropped image', () => {
    const source2 = read('../../src/app/dashboard/settings/page.js');
    expect(source2).toContain("positionerTarget === 'avatar' ? 1 : 3");
    expect(source2).toContain("positionerTarget === 'avatar' ? 'round' : 'rect'");
  });

  it('still uploads through the existing /api/upload-image endpoint, unchanged', () => {
    expect(source).toContain("authFetch('/api/upload-image'");
  });

  it('syncs preview/name/role state from userData via a real effect, not a fake useState(fn, deps)', () => {
    // useState's second argument is silently ignored by React — only
    // useEffect actually re-runs when a dependency changes. userData
    // loads asynchronously (Firestore via AuthContext), so without a
    // real effect here, a saved avatar/logo/name can permanently fail
    // to ever render on this page.
    expect(source).not.toMatch(/useState\(\(\) => \{[\s\S]*?\}, \[userData/);
    const effectStart = source.indexOf('useEffect(() => {');
    const effectBody = source.slice(effectStart, effectStart + 500);
    expect(effectBody).toContain('setAvatarPreview(userData.avatar');
    expect(effectBody).toContain('setLogoPreview(userData.logoUrl');
    expect(effectBody).toMatch(/\}, \[userData/);
  });

  it('a failed avatar/logo upload throws instead of silently falling back and still reporting success', () => {
    const fnStart = source.indexOf('const handleSave = async () => {');
    const fnBody = source.slice(fnStart, source.indexOf('const handleSmsSave', fnStart));
    expect(fnBody).not.toMatch(/if \(res\.ok\) \{\s*const data = await res\.json\(\);\s*avatarUrl = data\.url;\s*\}/);
    expect(fnBody).toContain('if (!res.ok) {');
    expect(fnBody).toContain('if (!logoRes.ok) {');
    expect(fnBody).toMatch(/throw new Error\(.*profile photo/);
    expect(fnBody).toMatch(/throw new Error\(.*agency logo/);
  });

  it('a failed save keeps avatarFile/logoFile set so retrying Save does not require re-cropping', () => {
    const fnStart = source.indexOf('const handleSave = async () => {');
    const fnBody = source.slice(fnStart, source.indexOf('const handleSmsSave', fnStart));
    const catchStart = fnBody.indexOf('} catch (err) {');
    const catchBody = fnBody.slice(catchStart);
    expect(catchBody).not.toContain('setAvatarFile(null)');
    expect(catchBody).not.toContain('setLogoFile(null)');
    expect(catchBody).toContain('setSaveError(');
  });

  it('exposes a Reposition action for the already-saved avatar and logo, not just newly-picked files', () => {
    expect(source).toContain("openRepositioner('avatar', avatarPreview)");
    expect(source).toContain("openRepositioner('logo', logoPreview)");
  });

  it('a failed crop/bake keeps the positioner open (with an error) instead of discarding the agent\'s crop', () => {
    const fnStart = source.indexOf('const handlePositionerSave = async');
    const fnBody = source.slice(fnStart, fnStart + 2000);
    const catchStart = fnBody.indexOf('} catch (err) {');
    const catchBody = fnBody.slice(catchStart, fnBody.indexOf('} finally', catchStart));
    expect(catchBody).not.toContain('closePositioner()');
    expect(catchBody).toContain('setPositionerError(');
  });
});

describe('dashboard/branding page — positioning never runs before colour extraction', () => {
  const source = read('../../src/app/dashboard/branding/page.js');

  it('the logo picker upload + colour extraction (handleLogoChange) has no positioner call in it', () => {
    const fnStart = source.indexOf('const handleLogoChange');
    const fnEnd = source.indexOf('\n  const', fnStart + 10);
    const fnBody = source.slice(fnStart, fnEnd);
    expect(fnBody).not.toContain('getCroppedImageBlob');
    expect(fnBody).toContain('extract-colors');
  });

  it('"Adjust logo positioning" is a separate, later, optional action', () => {
    expect(source).toContain('Adjust logo positioning');
    expect(source).toContain('handleLogoPositionerSave');
  });

  it('positioning re-uploads via the same endpoint and updates uploadedLogoUrl, which confirm/preview already read', () => {
    const fnStart = source.indexOf('const handleLogoPositionerSave');
    const fnEnd = source.indexOf('\n  const handleConfirm', fnStart);
    const fnBody = source.slice(fnStart, fnEnd);
    expect(fnBody).toContain("authFetch('/api/upload-image'");
    expect(fnBody).toContain('setUploadedLogoUrl(url)');
  });
});

describe('AgentModal.js — team-agent avatar gets the same positioner + reliability treatment', () => {
  const source = read('../../src/app/components/AgentModal.js');

  it('wires in the shared ImagePositioner, round crop, same as the settings-page avatar', () => {
    expect(source).toContain("from './ImagePositioner'");
    expect(source).toContain('cropShape="round"');
  });

  it('exposes a Reposition action for the already-saved avatar, not just a newly-picked file', () => {
    expect(source).toContain('const openRepositioner = () => {');
    expect(source).toContain('onClick={openRepositioner}');
  });

  it('a failed avatar upload throws instead of silently keeping the old url and still reporting success', () => {
    const fnStart = source.indexOf('const handleSave = async () => {');
    const fnBody = source.slice(fnStart, source.indexOf('return (', fnStart));
    expect(fnBody).not.toMatch(/if \(res\.ok\) \{\s*const \{ url \} = await res\.json\(\);\s*avatarUrl = url;\s*\}/);
    expect(fnBody).toContain('if (!res.ok) {');
    expect(fnBody).toMatch(/throw new Error\(/);
  });

  it('a save failure is surfaced to the agent, not just logged silently', () => {
    const fnStart = source.indexOf('const handleSave = async () => {');
    const fnBody = source.slice(fnStart, source.indexOf('return (', fnStart));
    const catchStart = fnBody.indexOf('} catch (err) {');
    const catchBody = fnBody.slice(catchStart);
    expect(catchBody).toContain('setSaveError(');
  });

  it('a failed crop/bake keeps the positioner open instead of discarding the crop', () => {
    const fnStart = source.indexOf('const handlePositionerSave = async');
    const fnBody = source.slice(fnStart, fnStart + 800);
    const catchStart = fnBody.indexOf('} catch (err) {');
    const catchBody = fnBody.slice(catchStart, fnBody.indexOf('} finally', catchStart));
    expect(catchBody).not.toContain('closePositioner()');
    expect(catchBody).toContain('setPositionerError(');
  });
});
