import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { buildMarketSummary } from '../../src/app/api/services/marketReportSummary';

const root = new URL('../../', import.meta.url).pathname;
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf-8');

function sourceFiles(dir) {
  return fs.readdirSync(path.join(root, dir), { withFileTypes: true }).flatMap((e) => {
    const rel = path.join(dir, e.name);
    if (e.isDirectory()) return sourceFiles(rel);
    return /\.(js|jsx|mjs|ts|tsx)$/.test(e.name) ? [rel] : [];
  });
}

describe('OpenAI and KIE are fully removed', () => {
  const files = sourceFiles('src');

  it('no source file imports OpenAI or reads its key', () => {
    const hits = files.filter((f) => /from ['"]openai['"]|require\(['"]openai['"]\)|OPENAI_API_KEY|openAiService/.test(read(f)));
    expect(hits).toEqual([]);
  });

  it('no source file calls KIE or the old image-edit / listing-generation routes', () => {
    const hits = files.filter((f) => /KIE_API|api\.kie\.ai|\/api\/ai\/image-edit|\/api\/generate-listing|ImageEditModal|AIImageEditing/.test(read(f)));
    expect(hits).toEqual([]);
  });

  it('the removed routes and component no longer exist', () => {
    for (const rel of [
      'src/app/api/ai/image-edit/route.js',
      'src/app/api/ai/image-edit/apply/route.js',
      'src/app/api/generate-listing/route.js',
      'src/app/api/services/openAiService.js',
      'src/app/components/AgentAIImageEditing.js',
    ]) {
      expect(fs.existsSync(path.join(root, rel)), rel).toBe(false);
    }
  });

  it('openai is no longer a dependency', () => {
    const pkg = JSON.parse(read('package.json'));
    expect(pkg.dependencies?.openai).toBeUndefined();
    expect(pkg.devDependencies?.openai).toBeUndefined();
  });

  it('the market report builds its summary from the scores, not an AI call', () => {
    const route = read('src/app/api/cron/market-report/route.js');
    expect(route).toContain("from '../../services/marketReportSummary'");
    expect(route).toContain('buildMarketSummary(');
    expect(route).not.toMatch(/AI Market Summary|aiSummary|openai/i);
  });
});

describe('buildMarketSummary', () => {
  const phi = { bdi: 72.4, smi: 55, pvi: 81, mhi: 64.6, evs: 48, bqi: 60, fpi: 31.2, sdb: 50 };
  const stats = {
    totalProperties: 40,
    publicProperties: 25,
    totalOffers: 120,
    seriousOffers: 30,
    totalLikes: 200,
    newPropsYesterday: 2,
    newOffersYesterday: 5,
  };

  it('is deterministic and reads the scores directly', () => {
    const a = buildMarketSummary({ phi, stats, confidence: { level: 'high', score: 90 } });
    const b = buildMarketSummary({ phi, stats, confidence: { level: 'high', score: 90 } });
    expect(a).toBe(b);
    expect(a).toBe(
      'Market health is strong at 65/100.' +
        ' The strongest signal is price alignment (81/100) and the weakest is the future listing pipeline (31/100).' +
        ' Over the last 30 days buyers left 120 opinions (30 serious) and 200 likes across 40 active properties' +
        ' (25 public), with 2 new properties and 5 new opinions yesterday.' +
        ' Asking prices are well aligned with buyer opinions (price alignment 81/100).'
    );
  });

  it('flags weak price alignment', () => {
    const text = buildMarketSummary({ phi: { ...phi, pvi: 25 }, stats, confidence: { level: 'medium', score: 60 } });
    expect(text).toContain('Asking prices are not well aligned with buyer opinions (price alignment 25/100)');
  });

  it('adds a caveat when data confidence is low', () => {
    const text = buildMarketSummary({ phi, stats, confidence: { level: 'low', score: 22 } });
    expect(text).toContain('Data confidence is low (22/100), so treat these scores as indicative.');
  });

  it('copes with missing or empty data without throwing', () => {
    const text = buildMarketSummary({ phi: {}, stats: { totalProperties: 1, newPropsYesterday: 1 } });
    expect(text).toBe(
      'Market health is very weak at 0/100.' +
        ' Over the last 30 days buyers left 0 opinions (0 serious) and 0 likes across 1 active property' +
        ' (0 public), with 1 new property and 0 new opinions yesterday.' +
        ' Asking prices are not well aligned with buyer opinions (price alignment 0/100), so price guidance is worth reviewing.'
    );
    expect(() => buildMarketSummary()).not.toThrow();
  });
});
