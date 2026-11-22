import { adminDb } from '../../firebase/adminApp';
import { NORMALIZATION } from './phiScoring';
import { withoutExcluded } from '../../utils/opinionExclusion';

// ─── Geocoding ──────────────────────────────────────────────────────────────

const MAPBOX_TOKEN = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;

/**
 * Geocode a location query to lat/lng using Mapbox.
 * Accepts either a freeform string or structured {suburb, state, postcode}.
 */
export async function geocodeLocation({ location, suburb, state, postcode, country = 'AU' }) {
  // Prefer freeform location string, fall back to structured parts
  const query = location || [suburb, state, postcode, country].filter(Boolean).join(', ');

  if (!query) return null;
  if (!MAPBOX_TOKEN) {
    throw new Error('NEXT_PUBLIC_MAPBOX_TOKEN not configured');
  }

  const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(query)}.json?access_token=${MAPBOX_TOKEN}&limit=1&country=${country.toLowerCase()}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error('Geocoding request failed');

  const data = await res.json();
  if (!data.features?.length) return null;

  const [lng, lat] = data.features[0].center;
  return { lat, lng, placeName: data.features[0].place_name };
}

// ─── Distance Calculation ───────────────────────────────────────────────────

const EARTH_RADIUS_KM = 6371;

function toRad(deg) {
  return (deg * Math.PI) / 180;
}

/**
 * Haversine distance between two points in km.
 */
export function haversineDistance(lat1, lng1, lat2, lng2) {
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return EARTH_RADIUS_KM * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * Convert center + radius to lat/lng bounding box.
 */
function getBoundingBox(lat, lng, radiusKm) {
  const latDelta = radiusKm / 111.32;
  const lngDelta = radiusKm / (111.32 * Math.cos(toRad(lat)));
  return {
    minLat: lat - latDelta,
    maxLat: lat + latDelta,
    minLng: lng - lngDelta,
    maxLng: lng + lngDelta,
  };
}

// ─── Firestore Queries ──────────────────────────────────────────────────────

/**
 * Get all properties within a radius of a point.
 * Uses bounding box for Firestore query, then Haversine for exact filtering.
 */
export async function getPropertiesInRadius(lat, lng, radiusKm = 5, { maxAgeDays } = {}) {
  const { minLat, maxLat, minLng, maxLng } = getBoundingBox(lat, lng, radiusKm);

  const snapshot = await adminDb
    .collection('properties')
    .where('location.latitude', '>=', minLat)
    .where('location.latitude', '<=', maxLat)
    .get();

  const cutoff = maxAgeDays ? Date.now() - maxAgeDays * 86400000 : null;

  // Post-filter by longitude, distance, active status, and age
  return snapshot.docs
    .map((doc) => ({ id: doc.id, ...doc.data() }))
    .filter((p) => {
      if (p.active === false || p.archived === true) return false;
      const pLat = p.location?.latitude;
      const pLng = p.location?.longitude;
      if (pLat == null || pLng == null) return false;
      if (pLng < minLng || pLng > maxLng) return false;
      if (haversineDistance(lat, lng, pLat, pLng) > radiusKm) return false;
      if (cutoff) {
        const created = toTimestamp(p.createdAt);
        if (created && created < cutoff) return false;
      }
      return true;
    });
}

/**
 * Get all offers/opinions for a set of property IDs.
 * Firestore 'in' queries support max 30 items, so we batch.
 */
export async function getOffersForProperties(propertyIds) {
  if (!propertyIds.length) return [];

  const results = [];
  const batches = [];
  for (let i = 0; i < propertyIds.length; i += 30) {
    batches.push(propertyIds.slice(i, i + 30));
  }

  for (const batch of batches) {
    const snapshot = await adminDb
      .collection('offers')
      .where('propertyId', 'in', batch)
      .get();
    results.push(...snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() })));
  }
  // Opinions excluded by Premarket never feed any score or insight (utils/opinionExclusion.js).
  return withoutExcluded(results);
}

/**
 * Get all likes for a set of property IDs.
 */
export async function getLikesForProperties(propertyIds) {
  if (!propertyIds.length) return [];

  const results = [];
  const batches = [];
  for (let i = 0; i < propertyIds.length; i += 30) {
    batches.push(propertyIds.slice(i, i + 30));
  }

  for (const batch of batches) {
    const snapshot = await adminDb
      .collection('likes')
      .where('propertyId', 'in', batch)
      .get();
    results.push(...snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() })));
  }
  return results;
}

/**
 * Fetch propertyEngagement records for given property IDs.
 */
export async function getEngagementForProperties(propertyIds) {
  if (!propertyIds.length) return [];

  const results = [];
  const batches = [];
  for (let i = 0; i < propertyIds.length; i += 30) {
    batches.push(propertyIds.slice(i, i + 30));
  }

  for (const batch of batches) {
    const snapshot = await adminDb
      .collection('propertyEngagement')
      .where('propertyId', 'in', batch)
      .get();
    results.push(...snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() })));
  }
  return results;
}

// ─── Eagerness Helpers ──────────────────────────────────────────────────────

/**
 * Check if a property's seller is eager to sell.
 * Handles both new format (0=Very serious, 1=Serious if price right, 2=Testing)
 * and legacy format (0-100 scale where >=70 = eager).
 */
export function isEagerSeller(p) {
  const val = p.isEager;
  if (val == null) return false;
  if (val <= 2) return val === 0; // New format: 0 = "Very serious"
  return val >= 70;               // Legacy format
}

/**
 * Get a 0-1 eagerness weight for a property.
 * New format: 0=1.0 (Very serious), 1=0.6 (Serious if price right), 2=0.2 (Testing)
 * Legacy format: normalized from 0-100 scale.
 */
export function getEagernessWeight(p) {
  const val = p.isEager;
  if (val == null) return 0;
  if (val <= 2) return [1.0, 0.6, 0.2][val];
  return val / 100; // Legacy normalize
}

// ─── Score Algorithms ───────────────────────────────────────────────────────

/**
 * Buyer Score (0–100) for a set of properties.
 *
 * Signals:
 * - Count of opinions (type == 'opinion')
 * - Count of serious buyers (serious == true), weighted 3x
 * - Count of likes
 * - Seriousness level distribution (higher levels = more weight)
 * - First home buyer vs investor diversity
 */
export function calculateBuyerScore(properties, offers, likes) {
  if (!properties.length) return { score: 0, breakdown: {} };

  const opinions = offers.filter((o) => o.type === 'opinion');
  const seriousBuyers = opinions.filter((o) => o.serious === true);
  const totalOpinions = opinions.length;
  const totalSerious = seriousBuyers.length;
  const totalLikes = likes.length;

  // Seriousness level weights (matches Flutter app values)
  const levelWeights = { just_browsing: 1, interested: 2, very_interested: 3, ready_to_buy: 4 };
  const seriousnessScore = opinions.reduce((sum, o) => {
    const level = (o.seriousnessLevel || '').toLowerCase();
    return sum + (levelWeights[level] || 1);
  }, 0);

  // Buyer diversity (FHB vs investor mix)
  const fhbCount = opinions.filter((o) => o.isFirstHomeBuyer).length;
  const investorCount = opinions.filter((o) => o.isInvestor).length;
  const totalTyped = fhbCount + investorCount;
  const diversityRatio = totalTyped > 0
    ? 1 - Math.abs(fhbCount - investorCount) / totalTyped
    : 0;

  const { MAX_OPINIONS, MAX_SERIOUS, MAX_LIKES, MAX_SERIOUSNESS } = NORMALIZATION;

  // Normalize each signal 0–1
  const normOpinions = Math.min(totalOpinions / MAX_OPINIONS, 1);
  const normSerious = Math.min(totalSerious / MAX_SERIOUS, 1);
  const normLikes = Math.min(totalLikes / MAX_LIKES, 1);
  const normSeriousness = Math.min(seriousnessScore / MAX_SERIOUSNESS, 1);

  // Weighted sum
  const weights = { opinions: 0.2, serious: 0.35, likes: 0.15, seriousness: 0.2, diversity: 0.1 };
  const raw =
    normOpinions * weights.opinions +
    normSerious * weights.serious +
    normLikes * weights.likes +
    normSeriousness * weights.seriousness +
    diversityRatio * weights.diversity;

  const score = Math.round(raw * 100);

  return {
    score,
    breakdown: {
      totalOpinions,
      seriousBuyers: totalSerious,
      passiveBuyers: totalOpinions - totalSerious,
      totalLikes,
      seriousnessScore,
      diversityRatio: Math.round(diversityRatio * 100) / 100,
      fhbCount,
      investorCount,
    },
  };
}

/**
 * Seller Score (0–100) for a set of properties.
 *
 * Signals:
 * - Count of active properties
 * - Properties with gotoMarketGoal within 30/60/90 days
 * - Seller eagerness (weighted: 0=Very serious, 1=Serious, 2=Testing)
 * - Listing density
 */
export function calculateSellerScore(properties) {
  if (!properties.length) return { score: 0, breakdown: {} };

  const now = Date.now();
  const DAY_MS = 86400000;

  const activeProperties = properties.filter((p) => p.visibility === true);

  // Go-to-market timeline
  const goingToMarket30 = properties.filter((p) => {
    const goal = toTimestamp(p.gotoMarketGoal);
    return goal && goal > now && goal <= now + 30 * DAY_MS;
  });
  const goingToMarket60 = properties.filter((p) => {
    const goal = toTimestamp(p.gotoMarketGoal);
    return goal && goal > now && goal <= now + 60 * DAY_MS;
  });
  const goingToMarket90 = properties.filter((p) => {
    const goal = toTimestamp(p.gotoMarketGoal);
    return goal && goal > now && goal <= now + 90 * DAY_MS;
  });

  // Weighted eagerness: sum of all eagerness weights (handles both new 0/1/2 and legacy 0-100)
  const eagernessSum = properties.reduce((sum, p) => sum + getEagernessWeight(p), 0);
  const eagerCount = properties.filter((p) => isEagerSeller(p)).length;

  const { MAX_ACTIVE, MAX_GTM, MAX_EAGER, MAX_OPINIONS } = NORMALIZATION;
  const normActive = Math.min(activeProperties.length / MAX_ACTIVE, 1);
  const normGtm30 = Math.min(goingToMarket30.length / MAX_GTM, 1);
  const normGtm60 = Math.min(goingToMarket60.length / MAX_GTM, 1);
  const normEager = Math.min(eagernessSum / MAX_EAGER, 1);
  const normDensity = Math.min(properties.length / MAX_OPINIONS, 1);

  const weights = { active: 0.25, gtm30: 0.3, gtm60: 0.1, eager: 0.2, density: 0.15 };
  const raw =
    normActive * weights.active +
    normGtm30 * weights.gtm30 +
    normGtm60 * weights.gtm60 +
    normEager * weights.eager +
    normDensity * weights.density;

  const score = Math.round(raw * 100);

  return {
    score,
    breakdown: {
      activeProperties: activeProperties.length,
      totalProperties: properties.length,
      goingToMarket30: goingToMarket30.length,
      goingToMarket60: goingToMarket60.length,
      goingToMarket90: goingToMarket90.length,
      eagerSellers: eagerCount,
      eagernessWeightedScore: Math.round(eagernessSum * 100) / 100,
    },
  };
}

// ─── Utilities ──────────────────────────────────────────────────────────────

/**
 * Convert a Firestore timestamp or date string to epoch ms.
 */
function toTimestamp(val) {
  if (!val) return null;
  if (val.toMillis) return val.toMillis();
  if (val.seconds) return val.seconds * 1000;
  const d = new Date(val);
  return isNaN(d.getTime()) ? null : d.getTime();
}

/**
 * Median of a numeric array.
 */
export function median(arr) {
  if (!arr.length) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

// Re-export formatPrice from shared utility
export { formatPrice } from '../../utils/formatters';

/**
 * Parse common location query params from a request URL.
 * Supports: lat/lng, suburb+state, postcode, or freeform location string.
 */
export async function parseLocationParams(request) {
  const { searchParams } = new URL(request.url);

  let lat = parseFloat(searchParams.get('lat'));
  let lng = parseFloat(searchParams.get('lng'));
  const radius = parseFloat(searchParams.get('radius')) || 10;
  const location = searchParams.get('location');
  const suburb = searchParams.get('suburb');
  const state = searchParams.get('state');
  const postcode = searchParams.get('postcode');
  const country = searchParams.get('country') || 'AU';

  let resolvedPlace = null;

  // If lat/lng not provided, geocode from location/suburb/postcode
  if (isNaN(lat) || isNaN(lng)) {
    if (!location && !suburb && !postcode) {
      return { error: 'Provide lat/lng, location, suburb/state, or postcode' };
    }
    const geo = await geocodeLocation({ location, suburb, state, postcode, country });
    if (!geo) {
      return { error: `Could not geocode location: ${location || suburb || postcode}` };
    }
    lat = geo.lat;
    lng = geo.lng;
    resolvedPlace = geo.placeName;
  }

  return { lat, lng, radius, location, suburb, state, postcode, country, resolvedPlace };
}
