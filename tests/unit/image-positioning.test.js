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
