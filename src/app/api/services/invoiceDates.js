// Invoice date and due date for a Xero invoice, on the Brisbane calendar (Premarket's
// time zone: UTC+10, no daylight saving). Both dates are sent to Xero explicitly.
// Before this, only the due date was sent, worked out on the server's UTC calendar,
// while Xero dated the invoice on the organisation's calendar. An invoice sent before
// 10am Brisbane time was then due 13 days after its date instead of 14.
//
// Pure, so the Preview and the real Send produce identical dates for the same moment.

const TIME_ZONE = 'Australia/Brisbane';
export const DEFAULT_PAYMENT_TERMS_DAYS = 14;

function brisbaneCalendarDay(now) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', { timeZone: TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit' })
      .formatToParts(now)
      .map((p) => [p.type, p.value]),
  );
  return { year: Number(parts.year), month: Number(parts.month), day: Number(parts.day) };
}

const ymd = (d) => d.toISOString().slice(0, 10);

/**
 * { date, dueDate, paymentTermsDays } as Xero's YYYY-MM-DD strings: `date` is today in
 * Brisbane, `dueDate` exactly `paymentTermsDays` calendar days later. Anything other
 * than a positive whole number of days falls back to the 14-day default.
 */
export function invoiceDates(now = new Date(), paymentTermsDays = DEFAULT_PAYMENT_TERMS_DAYS) {
  const days = Number.isInteger(paymentTermsDays) && paymentTermsDays > 0 ? paymentTermsDays : DEFAULT_PAYMENT_TERMS_DAYS;
  const { year, month, day } = brisbaneCalendarDay(now);
  return {
    date: ymd(new Date(Date.UTC(year, month - 1, day))),
    dueDate: ymd(new Date(Date.UTC(year, month - 1, day + days))),
    paymentTermsDays: days,
  };
}
