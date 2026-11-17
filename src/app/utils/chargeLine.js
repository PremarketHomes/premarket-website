// Shared (client + server) formatting for a billed property: the admin
// Charges / Invoice Run screens and the Xero invoice line description.
// Missing parts are left out, never filled in.

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const TIME_ZONE = 'Australia/Brisbane';

const clean = (v) => (typeof v === 'string' && v.trim() ? v.trim() : null);

/** "17 Nov 2026" (Brisbane calendar date), or null when there is no valid date. */
export function formatChargeDate(value) {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-AU', { timeZone: TIME_ZONE, day: 'numeric', month: 'numeric', year: 'numeric' })
      .formatToParts(d)
      .map((p) => [p.type, p.value]),
  );
  return `${Number(parts.day)} ${MONTHS[Number(parts.month) - 1]} ${parts.year}`;
}

/** "28 Brighton Crescent, Robina QLD, Australia — Mitch Harrop — 17 Nov 2026" */
export function chargeLineDescription({ address, sellingAgentName, submittedAt }) {
  return [clean(address), clean(sellingAgentName), formatChargeDate(submittedAt)].filter(Boolean).join(' — ');
}
