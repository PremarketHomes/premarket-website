// Plain-language summary for the daily Market Health Report email.
// Built only from the PHI scores and platform counts the report already
// calculates, so the same inputs always give the same text.

const SIGNALS = {
  bdi: 'buyer demand',
  smi: 'seller motivation',
  pvi: 'price alignment',
  evs: 'engagement speed',
  bqi: 'buyer quality',
  fpi: 'the future listing pipeline',
  sdb: 'supply-demand balance',
};

function score(value) {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n)) return 0;
  return Math.min(100, Math.max(0, n));
}

function band(value) {
  if (value >= 80) return 'very strong';
  if (value >= 60) return 'strong';
  if (value >= 40) return 'moderate';
  if (value >= 20) return 'weak';
  return 'very weak';
}

function count(value, singular, pluralWord = `${singular}s`) {
  const n = Math.max(0, Math.round(Number(value) || 0));
  return `${n} ${n === 1 ? singular : pluralWord}`;
}

/**
 * @param {object} input
 * @param {object} input.phi - PHI scores (0-100) keyed bdi, smi, pvi, mhi, evs, bqi, fpi, sdb
 * @param {object} input.stats - totalProperties, publicProperties, totalOffers, seriousOffers,
 *   totalLikes, newPropsYesterday, newOffersYesterday
 * @param {object} [input.confidence] - { level, score } from computeConfidence
 * @returns {string} 3-4 sentences, no HTML
 */
export function buildMarketSummary({ phi = {}, stats = {}, confidence = {} } = {}) {
  const mhi = score(phi.mhi);
  const sentences = [`Market health is ${band(mhi)} at ${mhi}/100.`];

  // Strongest and weakest signals (ties keep the order of SIGNALS).
  const ranked = Object.keys(SIGNALS)
    .map((key) => ({ key, value: score(phi[key]) }))
    .sort((a, b) => b.value - a.value);
  const top = ranked[0];
  const bottom = ranked[ranked.length - 1];
  if (top.value !== bottom.value) {
    sentences.push(
      `The strongest signal is ${SIGNALS[top.key]} (${top.value}/100) and the weakest is ${SIGNALS[bottom.key]} (${bottom.value}/100).`
    );
  }

  const n = (v) => Math.max(0, Math.round(Number(v) || 0));
  sentences.push(
    `Over the last 30 days buyers left ${count(stats.totalOffers, 'opinion')} (${n(stats.seriousOffers)} serious)` +
      ` and ${count(stats.totalLikes, 'like')} across ${count(stats.totalProperties, 'active property', 'active properties')}` +
      ` (${n(stats.publicProperties)} public), with ${count(stats.newPropsYesterday, 'new property', 'new properties')}` +
      ` and ${count(stats.newOffersYesterday, 'new opinion')} yesterday.`
  );

  const pvi = score(phi.pvi);
  if (String(confidence.level || '').toLowerCase() === 'low') {
    sentences.push(`Data confidence is low (${score(confidence.score)}/100), so treat these scores as indicative.`);
  } else if (pvi < 40) {
    sentences.push(`Asking prices are not well aligned with buyer opinions (price alignment ${pvi}/100), so price guidance is worth reviewing.`);
  } else if (pvi >= 70) {
    sentences.push(`Asking prices are well aligned with buyer opinions (price alignment ${pvi}/100).`);
  }

  return sentences.join(' ');
}
