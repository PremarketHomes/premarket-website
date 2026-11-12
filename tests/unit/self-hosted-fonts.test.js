import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

// Production builds on Vercel failed (Nov 2026) whenever Google Fonts answered the build servers with a font URL
// format next/font/google cannot parse. Fonts are now self-hosted with next/font/local; keep it that way.
const root = path.resolve(__dirname, '../../src');

function sourceFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return sourceFiles(p);
    return /\.(js|jsx|ts|tsx|mjs)$/.test(e.name) ? [p] : [];
  });
}

describe('self-hosted fonts', () => {
  it('no source file imports next/font/google (a build-time download from Google)', () => {
    const offenders = sourceFiles(root).filter((f) => /from\s+['"]next\/font\/google['"]/.test(fs.readFileSync(f, 'utf8')));
    expect(offenders.map((f) => path.relative(root, f))).toEqual([]);
  });

  it('every font file referenced by next/font/local exists in the repo', () => {
    const refs = [];
    for (const f of sourceFiles(root)) {
      const src = fs.readFileSync(f, 'utf8');
      if (!src.includes('next/font/local')) continue;
      for (const m of src.matchAll(/path:\s*['"]([^'"]+\.woff2)['"]/g)) refs.push(path.resolve(path.dirname(f), m[1]));
    }
    expect(refs.length).toBe(8);
    for (const r of refs) expect(fs.existsSync(r), path.relative(root, r)).toBe(true);
  });
});
