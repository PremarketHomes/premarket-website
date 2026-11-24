export const money = (v) => new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD', maximumFractionDigits: 0 }).format(v || 0);
export const compactMoney = (v) => new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD', notation: 'compact', maximumFractionDigits: 2 }).format(v || 0);
export const timeOfDay = (iso) => new Date(iso).toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit' }).replace(/\s/g, '').toLowerCase();
export const dayLabel = (iso) => new Date(iso).toLocaleDateString('en-AU', { weekday: 'long', day: 'numeric', month: 'long' });
export const shortDay = (iso) => new Date(iso).toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short' });
export const minutesBetween = (a, b) => Math.max(0, Math.round((new Date(b) - new Date(a)) / 60000));

/** +61412345678 → 0412 345 678 (Australian mobiles); anything else unchanged. */
export function localMobile(e164) {
  const m = /^\+614(\d{2})(\d{3})(\d{3})$/.exec(e164 || '');
  return m ? `04${m[1]} ${m[2]} ${m[3]}` : (e164 || '');
}
