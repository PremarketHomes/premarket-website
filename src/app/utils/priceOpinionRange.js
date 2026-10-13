import { roundToStep } from './priceOpinionStep';

/**
 * How far either side of the base price the opinion slider lets a buyer
 * move. Previously 25% — widened to 35% because the tighter range was
 * silently clamping genuinely strong opinions at the edge: a buyer who
 * believed a property was worth meaningfully more or less than the
 * range allowed could only ever submit the boundary value, which
 * quietly truncated the exact signal this feature exists to collect.
 */
export const PRICE_OPINION_RANGE_FRACTION = 0.35;

function toDouble(v) {
  if (!v) return 0;
  if (typeof v === 'number') return v;
  if (typeof v === 'string') {
    const cleaned = v.replace(/[^\d.]/g, '');
    return parseFloat(cleaned) || 0;
  }
  return 0;
}

/**
 * Pure function: derives the base reference price for a property from
 * whatever data is available (explicit price, AI price estimate,
 * price guide, or a 1,000,000 fallback — unchanged priority order from
 * the original implementation), then returns the opinion range either
 * side of it. Never reads from or writes to anything stored — this is
 * display/interaction scaffolding only, not a value Premarket asserts.
 */
export function computePriceOpinionRange(property) {
  let basePrice = toDouble(property?.price);

  if (basePrice === 0) {
    const priceEstimate = property?.propertyJob?.price_estimate;
    if (priceEstimate) {
      basePrice = toDouble(priceEstimate.mid) || toDouble(priceEstimate.high) || toDouble(priceEstimate.low);
    }
  }

  if (basePrice === 0) {
    basePrice = toDouble(property?.priceGuide);
  }

  if (basePrice === 0) {
    basePrice = 1000000;
  }

  const min = roundToStep(basePrice * (1 - PRICE_OPINION_RANGE_FRACTION));
  const max = roundToStep(basePrice * (1 + PRICE_OPINION_RANGE_FRACTION));

  return { min, max };
}
