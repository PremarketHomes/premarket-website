import { describe, it, expect } from 'vitest';
import fs from 'node:fs';

// No @testing-library/react / jsdom in this project — matching the
// established pattern elsewhere, this verifies the fix via source
// inspection rather than rendering the component.

function readPropertyPageClient() {
  return fs.readFileSync(
    new URL('../../src/app/components/PropertyPageClient.js', import.meta.url),
    'utf-8'
  );
}

describe('priceOpinion initial render — no minimum-to-midpoint flicker', () => {
  it('priceOpinion is seeded from initialRange\'s midpoint, not a bare 0', () => {
    // The bug: priceOpinion used to start at useState(0) while minPrice/
    // maxPrice were already seeded from initialRange. A range input
    // clamps an out-of-range value to its min for display, so the first
    // paint showed the thumb pinned at the minimum before the
    // fetchPreviousOffer effect resolved a moment later and visibly
    // moved it to the midpoint.
    const source = readPropertyPageClient();
    expect(source).toContain(
      "const [priceOpinion, setPriceOpinion] = useState(\n    initialRange ? roundToStep((initialRange.min + initialRange.max) / 2) : 0\n  );"
    );
  });

  it('priceOpinion is declared after initialRange, so it can reference it', () => {
    const source = readPropertyPageClient();
    const initialRangeIdx = source.indexOf('const initialRange =');
    const priceOpinionIdx = source.indexOf('const [priceOpinion, setPriceOpinion] = useState(');
    expect(initialRangeIdx).toBeGreaterThan(-1);
    expect(priceOpinionIdx).toBeGreaterThan(initialRangeIdx);
  });

  it('hasInteracted still starts false regardless — the seeded midpoint is never a real opinion until a genuine drag', () => {
    const source = readPropertyPageClient();
    expect(source).toContain('const [hasInteracted, setHasInteracted] = useState(false);');
  });
});
