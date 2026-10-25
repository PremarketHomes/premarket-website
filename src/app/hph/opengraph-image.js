import { ImageResponse } from 'next/og';
import { OFFICES } from '../components/office-landing/offices';

export const alt = 'Harcourts Property Hub — powered by Premarket';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

const { name, navy, blue } = OFFICES.hph;

export default function Image() {
  return new ImageResponse(
    (
      <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'space-between', background: navy, color: '#fff', padding: 80 }}>
        <div style={{ fontSize: 40, fontWeight: 600 }}>{name}</div>
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <div style={{ width: 96, height: 8, background: blue, marginBottom: 32 }} />
          <div style={{ fontSize: 68, fontWeight: 700, lineHeight: 1.1 }}>
            Understand your property&apos;s potential before going to market.
          </div>
        </div>
        <div style={{ fontSize: 28, color: 'rgba(255,255,255,0.65)' }}>Powered by Premarket</div>
      </div>
    ),
    size
  );
}
