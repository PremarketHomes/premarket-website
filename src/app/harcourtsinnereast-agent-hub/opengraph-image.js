import { ImageResponse } from 'next/og';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { BRANDED_PAGES } from '../components/office-landing/offices';

// Same card as /hph-agent-hub/opengraph-image.js, with the Harcourts Inner East name and logo.
export const alt = 'Harcourts Inner East — Agent Hub';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

const { name, navy, blue, logo } = BRANDED_PAGES.harcourtsinnereast;

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
          <div style={{ fontSize: 28, letterSpacing: 4, color: blue, fontWeight: 700, marginBottom: 16 }}>{name.toUpperCase()}</div>
          <div style={{ fontSize: 104, fontWeight: 700, lineHeight: 1.1 }}>Agent Hub</div>
        </div>
        <div style={{ fontSize: 28, color: 'rgba(255,255,255,0.65)' }}>{`${name} — Agent Hub`}</div>
      </div>
    ),
    size
  );
}
