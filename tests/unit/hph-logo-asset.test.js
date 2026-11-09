import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { OFFICES } from '../../src/app/components/office-landing/offices';

const pngSize = (buf) => ({ w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) });

describe('Harcourts Property Hub logo', () => {
  it('the supplied full-colour logo is hosted unmodified at its original size', () => {
    const buf = readFileSync('public/offices/hph/logo-colour.png');
    expect(buf.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
    expect(pngSize(buf)).toEqual({ w: 636, h: 314 });
    expect(OFFICES.hph.logoColour).toEqual({ src: '/offices/hph/logo-colour.png', width: 636, height: 314 });
  });
  it('landing pages keep the white full HPH logo on navy; no other office is touched', () => {
    expect(OFFICES.hph.logo.src).toBe('/offices/hph/logo-white.png');
    expect(Object.keys(OFFICES)).toEqual(['hph']);
  });
  it('the office branding logo is not hardcoded anywhere in the app', () => {
    for (const p of ['src/app/components/property-page/PropertyHeader.js', 'src/app/utils/brandStyle.js', 'src/app/utils/officeBrand.js']) {
      expect(readFileSync(p, 'utf8')).not.toContain('logo-colour.png');
    }
  });
});
