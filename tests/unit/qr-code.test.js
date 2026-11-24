// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { createHash } from 'crypto';
import { createElement } from 'react';
import { render } from '@testing-library/react';
import { encodeQr, qrSvgPath } from '../../src/app/utils/qrCode';
import QrCode from '../../src/app/components/QrCode';

// utils/qrCode.js: Premarket's own QR generator (used by the Open Home concept's entrance signs). Structure is checked
// here against the QR specification; the exact matrices below were decoded by an independent decoder (jsQR) when this
// encoder was written (124 payloads, versions 1–36, every mask and error level, plus damage tests), so they lock it.

const matrix = (qr) => {
  let s = '';
  for (let y = 0; y < qr.size; y += 1) {
    for (let x = 0; x < qr.size; x += 1) s += qr.isDark(x, y) ? '1' : '0';
    s += '\n';
  }
  return s;
};
const sha = (s) => createHash('sha256').update(s).digest('hex');

const ECC_FORMAT_BITS = { L: 1, M: 0, Q: 3, H: 2 };

function readFormat(qr) {
  // First copy, as drawn around the top-left finder (bit i at the positions the spec assigns).
  const at = (x, y) => (qr.isDark(x, y) ? 1 : 0);
  const pos = [[8, 0], [8, 1], [8, 2], [8, 3], [8, 4], [8, 5], [8, 7], [8, 8], [7, 8], [5, 8], [4, 8], [3, 8], [2, 8], [1, 8], [0, 8]];
  let bits = 0;
  pos.forEach(([x, y], i) => { bits |= at(x, y) << i; });
  // Second copy: bottom-left column and top-right row.
  let bits2 = 0;
  for (let i = 0; i < 8; i += 1) bits2 |= at(qr.size - 1 - i, 8) << i;
  for (let i = 8; i < 15; i += 1) bits2 |= at(8, qr.size - 15 + i) << i;
  return { bits, bits2 };
}

function bchFormatOk(raw) {
  const data = raw >>> 10;
  let rem = data;
  for (let i = 0; i < 10; i += 1) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
  return (((data << 10) | rem) & 0x7fff) === raw;
}

describe('QR generator', () => {
  it('matches the independently decoded reference matrices', () => {
    const cases = [
      ['https://premarket.homes/concepts/open-home/visit?property=demo-banksia&session=K7Q2XM', 'Q', 7, 2, '3e8e577f51ea50939bdafaa26a047f8690b00decef8a61b11cd1e419c1d452cd'],
      ['https://premarket.homes/prop4827319056', 'M', 3, 3, '5e95ab49043ed9ab7bd3bc23f8be0f5ab08ddde3348fe2288ef77bcfa29dd37d'],
      ['HELLO WORLD', 'L', 1, 3, '533e79a8b10b14288c10a149fe3fd41110d1775b51c38bc3e02f5ca4add653ba'],
    ];
    for (const [text, ecc, version, mask, hash] of cases) {
      const qr = encodeQr(text, { ecc });
      expect([qr.version, qr.mask, qr.size]).toEqual([version, mask, version * 4 + 17]);
      expect(sha(matrix(qr))).toBe(hash);
    }
  });

  it('draws the finder, timing and dark-module patterns and valid, matching format bits at every level', () => {
    for (const ecc of ['L', 'M', 'Q', 'H']) {
      for (const text of ['a', 'https://premarket.homes/concepts/open-home/visit?property=demo-banksia&session=K7Q2XM', 'x'.repeat(300)]) {
        const qr = encodeQr(text, { ecc });
        const finder = (ox, oy) => {
          for (let y = 0; y < 7; y += 1) {
            for (let x = 0; x < 7; x += 1) {
              const ring = Math.max(Math.abs(x - 3), Math.abs(y - 3));
              expect(qr.isDark(ox + x, oy + y)).toBe(ring !== 2);
            }
          }
        };
        finder(0, 0);
        finder(qr.size - 7, 0);
        finder(0, qr.size - 7);
        for (let i = 8; i < qr.size - 8; i += 1) {
          expect(qr.isDark(i, 6)).toBe(i % 2 === 0);
          expect(qr.isDark(6, i)).toBe(i % 2 === 0);
        }
        expect(qr.isDark(8, qr.size - 8)).toBe(true);
        const { bits, bits2 } = readFormat(qr);
        expect(bits).toBe(bits2);
        const raw = bits ^ 0x5412;
        expect(bchFormatOk(raw)).toBe(true);
        expect(raw >>> 13).toBe(ECC_FORMAT_BITS[ecc]);
        expect((raw >>> 10) & 7).toBe(qr.mask);
      }
    }
  });

  it('writes valid version information from version 7 up', () => {
    const qr = encodeQr('y'.repeat(200), { ecc: 'M' });
    expect(qr.version).toBeGreaterThanOrEqual(7);
    let bits = 0;
    for (let i = 0; i < 18; i += 1) bits |= (qr.isDark(qr.size - 11 + (i % 3), Math.floor(i / 3)) ? 1 : 0) << i;
    expect(bits >>> 12).toBe(qr.version);
    let rem = qr.version;
    for (let i = 0; i < 12; i += 1) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
    expect(bits).toBe((qr.version << 12) | rem);
  });

  it('picks bigger versions for longer text and higher levels, and refuses what cannot fit', () => {
    expect(encodeQr('x'.repeat(40), { ecc: 'H' }).version).toBeGreaterThan(encodeQr('x'.repeat(40), { ecc: 'L' }).version);
    expect(() => encodeQr('x'.repeat(3000), { ecc: 'H' })).toThrow();
    expect(() => encodeQr('x', { ecc: 'Z' })).toThrow();
  });

  it('the SVG path covers exactly the dark modules, offset by the quiet zone', () => {
    const qr = encodeQr('https://premarket.homes/prop4827319056');
    const path = qrSvgPath(qr, 4);
    const covered = [...path.matchAll(/M(\d+) (\d+)h(\d+)/g)].reduce((n, m) => n + Number(m[3]), 0);
    const dark = (matrix(qr).match(/1/g) || []).length;
    expect(covered).toBe(dark);
    expect(Math.min(...[...path.matchAll(/M(\d+) (\d+)/g)].map((m) => Number(m[1])))).toBe(4);
  });

  it('renders as an accessible, crisp SVG carrying the encoded link', () => {
    const { container } = render(createElement(QrCode, { value: 'https://premarket.homes/x', title: 'Scan to check in' }));
    const svg = container.querySelector('svg');
    expect(svg.getAttribute('role')).toBe('img');
    expect(svg.getAttribute('aria-label')).toBe('Scan to check in');
    expect(svg.getAttribute('shape-rendering')).toBe('crispEdges');
    expect(svg.getAttribute('data-qr-value')).toBe('https://premarket.homes/x');
  });
});
