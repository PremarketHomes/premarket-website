/**
 * What the buyer page may tell Google Tag Manager (and so Google Analytics or any tag added there later).
 *
 * An ALLOWLIST of campaign-level details only. Anything else passed in is dropped, so a buyer's price opinion, their
 * session or device id, their name, email, phone or account can never reach analytics, even by mistake in future code.
 * Event names still record that something happened (e.g. "price_opinion_created") for funnel counts.
 */
export const ANALYTICS_PARAM_ALLOWLIST = ['property_id', 'property_title', 'property_address', 'property_price', 'page_path'];

export function analyticsEvent(eventName, params = {}) {
  const out = { event: String(eventName) };
  for (const key of ANALYTICS_PARAM_ALLOWLIST) {
    if (params && params[key] !== undefined) out[key] = params[key];
  }
  return out;
}
