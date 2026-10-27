import { ImageResponse } from 'next/og';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { OFFICES } from '../components/office-landing/offices';

export const alt = 'Harcourts Property Hub × Premarket';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

const { name, navy, blue, logo } = OFFICES.hph;

export default async function Image() {
  const png = await readFile(path.join(process.cwd(), 'public', logo.src));
  const logoUri = `data:image/png;base64,${png.toString('base64')}`;
  const pm = await readFile(path.join(process.cwd(), 'public', 'brand', 'premarket-on-dark.png'));
  const pmUri = `data:image/png;base64,${pm.toString('base64')}`;
  return new ImageResponse(
    (
      <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'space-between', background: navy, color: '#fff', padding: 80 }}>
        <div style={{ display: 'flex', alignItems: 'center' }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={pmUri} alt="Premarket" width={250} height={45} />
          <div style={{ fontSize: 44, margin: '0 36px', color: 'rgba(255,255,255,0.5)' }}>×</div>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={logoUri} alt={name} width={Math.round(logo.width * 0.6)} height={Math.round(logo.height * 0.6)} />
        </div>
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <div style={{ width: 96, height: 8, background: blue, marginBottom: 32 }} />
          <div style={{ fontSize: 68, fontWeight: 700, lineHeight: 1.1 }}>
            Understand your property&apos;s potential before going to market.
          </div>
        </div>
        <div style={{ fontSize: 28, color: 'rgba(255,255,255,0.65)' }}>Harcourts Property Hub × Premarket</div>
      </div>
    ),
    size
  );
}
