import { readJson, writeJson } from './demoStorage';

/**
 * BUYER'S OWN PHONE ONLY: where this buyer is in their visit, so closing the browser and scanning again (or reopening
 * the tab) picks up where they left off. The agent side never reads this.
 *
 * { stage: 'checked-in' | 'complete', firstName, ref, outcome: null | 'opinion' | 'declined', interest: boolean }
 *   ref      the check-in reference, used only for "Register my interest" (identity side).
 *   outcome  whether THIS buyer gave an opinion, kept on their phone so the completion screen can thank them
 *            correctly. The amount itself is never stored, here or anywhere else on the identity side.
 */
const key = (sessionId) => `visit:${sessionId}`;

export const readVisit = (sessionId) => readJson(key(sessionId), null);
export const saveVisit = (sessionId, visit) => writeJson(key(sessionId), visit);
export const forgetVisit = (sessionId) => writeJson(key(sessionId), null);
