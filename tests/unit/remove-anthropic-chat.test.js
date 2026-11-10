import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const root = new URL('../../', import.meta.url).pathname;
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf-8');

function sourceFiles(dir) {
  return fs.readdirSync(path.join(root, dir), { withFileTypes: true }).flatMap((e) => {
    const rel = path.join(dir, e.name);
    if (e.isDirectory()) return sourceFiles(rel);
    return /\.(js|jsx|mjs|ts|tsx)$/.test(e.name) ? [rel] : [];
  });
}

// The dashboard playground chat called Anthropic on Premarket's key for any signed-in user
// (November 2026 incident). It is removed; the rest of the playground stays.
describe('Anthropic playground chat is fully removed', () => {
  const files = sourceFiles('src');

  it('no source file calls Anthropic or reads its key', () => {
    const hits = files.filter((f) => /ANTHROPIC_API_KEY|api\.anthropic\.com|@anthropic-ai\//.test(read(f)));
    expect(hits).toEqual([]);
  });

  it('nothing calls the removed /api/chat route or renders the chat panel', () => {
    const hits = files.filter((f) => /['"`]\/api\/chat['"`/]|ChatPanel/.test(read(f)));
    expect(hits).toEqual([]);
  });

  it('the removed route and component no longer exist', () => {
    for (const rel of [
      'src/app/api/chat/route.js',
      'src/app/dashboard/playground/components/ChatPanel.js',
    ]) {
      expect(fs.existsSync(path.join(root, rel)), rel).toBe(false);
    }
  });

  it('the playground keeps its non-chat features and its shared search component', () => {
    const page = read('src/app/dashboard/playground/page.js');
    for (const part of ['PHIHeatmap', 'LocationSearch', 'LocationReport', 'TrendingAreasTable', 'UpcomingToMarket']) {
      expect(page, part).toContain(part);
    }
    expect(fs.existsSync(path.join(root, 'src/app/dashboard/playground/components/LocationSearch.js'))).toBe(true);
  });

  it('no dependency on an Anthropic SDK', () => {
    const pkg = JSON.parse(read('package.json'));
    const deps = { ...pkg.dependencies, ...pkg.devDependencies };
    expect(Object.keys(deps).filter((d) => d.startsWith('@anthropic-ai/'))).toEqual([]);
  });
});
