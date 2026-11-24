import { checkIn, registerInterest, listAttendance } from './attendanceStore';
import { submitOpinion } from './opinionStore';
import { DEMO_PEOPLE, demoOpinionAmounts } from './sessionStore';
import { opinionRangeFor } from './demoProperties';

/**
 * "Simulate visitors" for presenting the agent dashboard without a room full of phones. Fictional buyers check in, and
 * opinions arrive separately, in a different order and at different moments, exactly as the two independent flows
 * would in real life. Everything goes through the same demo APIs a phone uses. Returns a stop function.
 */
export function simulateVisitors(session, property, { visitors = 8, everyMs = 1400 } = {}) {
  const range = opinionRangeFor(property);
  const taken = new Set(listAttendance(session.id).map((a) => a.email));
  const people = DEMO_PEOPLE.filter((p) => !taken.has(p.email)).slice(0, visitors);
  const amounts = demoOpinionAmounts(property, Math.round(people.length * 0.75));
  const timers = [];
  let stopped = false;
  people.forEach((person, i) => {
    timers.push(setTimeout(async () => {
      if (stopped) return;
      const res = await checkIn(session.id, { ...person, updatesOptIn: i % 3 === 0 });
      if (!stopped && res.ok && i % 4 === 1) {
        timers.push(setTimeout(() => { if (!stopped) registerInterest(session.id, res.ref, { wants: ['call'] }); }, everyMs * 3));
      }
    }, i * everyMs));
  });
  // Opinions: shuffled timing, not tied to any check-in.
  amounts.forEach((amount) => {
    const delay = everyMs * (2 + Math.random() * (people.length + 2));
    timers.push(setTimeout(() => { if (!stopped) submitOpinion(session.id, amount, range); }, delay));
  });
  return () => { stopped = true; timers.forEach(clearTimeout); };
}
