import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { transparentKioskLogo } from '../../src/app/utils/kioskLogo';

const read = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf-8');

describe('iPad open-home logo: the office\'s transparent logo instead of the boxed colour logo', () => {
  it('HPH\'s colour branding logo maps to its approved white-on-transparent logo (same asset set, in the repo)', () => {
    const white = { src: '/offices/hph/logo-white.png', width: 390, height: 174 };
    expect(transparentKioskLogo('https://premarket.homes/offices/hph/logo-colour.png')).toEqual(white);
    expect(transparentKioskLogo('/offices/hph/logo-colour.png')).toEqual(white);
  });

  it('any other logo keeps today\'s presentation (no mapping)', () => {
    for (const u of [null, '', 'https://premarketvideos.b-cdn.net/1789387148401-images.png', 'https://evil.example/offices/hph/logo-colour.png',
      'http://premarket.homes/offices/hph/logo-colour.png', 'https://premarket.homes/offices/hph/logo-white.png', 'not a url ::']) {
      expect(transparentKioskLogo(u)).toBeNull();
    }
  });

  it('the kiosk renders the transparent logo with no white box, at the same header height; the boxed fallback is unchanged', () => {
    const k = read('src/app/components/kiosk/OpenHomeKiosk.js');
    const transparent = k.slice(k.indexOf('{transparentLogo ? ('), k.indexOf(') : logoUrl ? ('));
    expect(transparent).toContain('h-[clamp(44px,7vh,76px)] w-auto max-w-[44vw] object-contain');
    expect(transparent).not.toMatch(/bg-white|rounded|p-2/);
    expect(k).toContain('className="h-[clamp(44px,7vh,76px)] w-auto max-w-[44vw] rounded-xl bg-white/95 object-contain p-2 shadow-lg"'); // other agencies
    expect(k).toContain('data-testid="kiosk-logo"'); // long-press staff exit wrapper untouched
  });
});
