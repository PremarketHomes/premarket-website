import { ImageResponse } from 'next/og';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { OFFICES } from '../components/office-landing/offices';

export const alt = 'Harcourts Property Hub — Price Intelligence';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

const { name, navy, blue, logo } = OFFICES.hph;

export default async function Image() {
  const png = await readFile(path.join(process.cwd(), 'public', logo.src));
  const logoUri = `data:image/png;base64,${png.toString('base64')}`;
  return new ImageResponse(
    (
      <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'space-between', background: navy, color: '#fff', padding: 80 }}>
        <div style={{ display: 'flex', alignItems: 'center' }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={logoUri} alt={name} width={Math.round(logo.width * 0.7)} height={Math.round(logo.height * 0.7)} />
        </div>
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <div style={{ width: 96, height: 8, background: blue, marginBottom: 32 }} />
          <div style={{ fontSize: 28, letterSpacing: 4, color: blue, fontWeight: 700, marginBottom: 16 }}>HARCOURTS PROPERTY HUB</div>
          <div style={{ fontSize: 88, fontWeight: 700, lineHeight: 1.1 }}>Price Intelligence</div>
        </div>
        <div style={{ fontSize: 28, color: 'rgba(255,255,255,0.65)' }}>Harcourts Property Hub — Price Intelligence</div>
      </div>
    ),
    size
  );
}
