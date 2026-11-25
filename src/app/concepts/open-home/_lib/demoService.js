import { checkIn, registerInterest } from './attendanceStore';
import { submitOpinion } from './opinionStore';
import { getSession } from './sessionStore';
import { readVisit, saveVisit } from './visitState';
import { subscribe } from './demoStorage';

/**
 * The concept demo's data service for BuyerJourney (browser-local demo stores). The live pilot supplies the same
 * interface backed by the server (open-home/liveService.js). The opinion call takes the amount and nothing else.
 */
export function createDemoService(sessionId, range) {
  return {
    loadVisit: () => readVisit(sessionId),
    saveVisit: (visit) => saveVisit(sessionId, visit),
    isEnded: () => !!getSession(sessionId)?.endedAt,
    subscribe: (fn) => subscribe((key) => { if (key === null || key === 'sessions' || key === `visit:${sessionId}`) fn(); }),
    checkIn: (details) => checkIn(sessionId, details),
    submitOpinion: (amount) => submitOpinion(sessionId, amount, range),
    registerInterest: (ref, wants) => registerInterest(sessionId, ref, { wants }),
  };
}
