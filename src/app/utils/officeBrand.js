import { useCallback, useEffect, useState } from 'react';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '../firebase/clientApp';
import { applyOfficeBrand } from './brandStyle';

const cache = new Map(); // officeId -> Promise<brand|null>, per page load. Failures are NOT cached.

/** Resolves an office's master brand via offices/{id}.agencyBrandId ->
 * agencyBrands/{id} (both publicly readable, same as the public property
 * page). Resolves null when the office genuinely has no brand configured;
 * REJECTS on a read error so callers can tell "no brand" from "couldn't
 * load" (and offer a retry) instead of guessing. */
export function fetchOfficeBrandStrict(officeId) {
  if (!officeId) return Promise.resolve(null);
  if (!cache.has(officeId)) {
    const p = (async () => {
      const office = await getDoc(doc(db, 'offices', officeId));
      const brandId = office.exists() ? office.data().agencyBrandId : null;
      if (!brandId) return null;
      const brand = await getDoc(doc(db, 'agencyBrands', brandId));
      return brand.exists() ? { id: brand.id, ...brand.data() } : null;
    })();
    cache.set(officeId, p);
    p.catch(() => cache.delete(officeId));
  }
  return cache.get(officeId);
}

/** Non-throwing variant for display-only callers that just fall back
 * (public pages): null on a missing brand OR any error. */
export async function fetchOfficeBrand(officeId) {
  try {
    return await fetchOfficeBrandStrict(officeId);
  } catch (err) {
    console.error('Error fetching office brand (non-fatal):', err);
    return null;
  }
}

/** applyOfficeBrand with the fetch built in — for pages that load agents
 * from users docs. `agent` must include `officeId`. */
export async function withOfficeBrand(agent) {
  if (!agent?.officeId) return agent;
  return applyOfficeBrand(agent, await fetchOfficeBrand(agent.officeId));
}

/** For the signed-in agent's own dashboard/Settings: status is
 * 'idle' (no office — independent agent), 'loading', 'ready' or
 * 'failed'. Callers show a neutral placeholder while loading and a
 * retry on failure — never the agent's old personal agency name. */
export function useOfficeBrand(officeId) {
  const [state, setState] = useState({ status: officeId ? 'loading' : 'idle', brand: null });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!officeId) { setState({ status: 'idle', brand: null }); return; }
    let cancelled = false;
    setState({ status: 'loading', brand: null });
    fetchOfficeBrandStrict(officeId)
      .then((brand) => { if (!cancelled) setState({ status: 'ready', brand }); })
      .catch(() => { if (!cancelled) setState({ status: 'failed', brand: null }); });
    return () => { cancelled = true; };
  }, [officeId, attempt]);
  const retry = useCallback(() => setAttempt((n) => n + 1), []);
  return { ...state, retry };
}
