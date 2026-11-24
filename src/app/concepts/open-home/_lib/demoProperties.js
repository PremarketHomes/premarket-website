import { OFFICES } from '../../../components/office-landing/offices';
import { computePriceOpinionRange } from '../../../utils/priceOpinionRange';

/**
 * Fictional demo listings for the Open Home concept. Not real campaigns, addresses, agents or vendors: the demo never
 * reads or writes a live property. Photos are Premarket's own homepage imagery.
 *
 * Co-branding is data, not code: `office` names an entry in the existing office branding config
 * (components/office-landing/offices.js: name, colours and the supplied logos), so another office is one entry there.
 * A listing with no office shows Premarket branding only. In production this comes from the campaign's own office
 * (users.officeId → offices → agencyBrands), exactly as the buyer property page and iPad kiosk already resolve it.
 */
export const DEMO_PROPERTIES = [
  {
    id: 'demo-banksia',
    street: '18 Banksia Rise',
    suburb: 'Robina',
    state: 'QLD',
    postcode: '4226',
    beds: 4,
    baths: 2,
    cars: 2,
    price: 1450000, // drives the slider range only (±25%, the existing rule); never shown to buyers
    imageUrl: '/prototype-homepage/hero-exterior.jpg',
    agentName: 'Alex Morgan',
    office: 'hph',
  },
  {
    id: 'demo-casuarina',
    street: '7 Casuarina Court',
    suburb: 'Mudgeeraba',
    state: 'QLD',
    postcode: '4213',
    beds: 4,
    baths: 3,
    cars: 2,
    price: 1180000,
    imageUrl: '/prototype-homepage/daytime-exterior.jpg',
    agentName: 'Alex Morgan',
    office: 'hph',
  },
  {
    id: 'demo-independent',
    street: '3 Lillypilly Lane',
    suburb: 'Bardon',
    state: 'QLD',
    postcode: '4065',
    beds: 3,
    baths: 2,
    cars: 1,
    price: 1650000,
    imageUrl: '/prototype-homepage/interior-living.jpg',
    agentName: 'Jordan Lee',
    office: null, // an agent with no office branding: Premarket only
  },
];

/** The demo's signed-in agent: an HPH agent whose dashboard lists their own two demo listings. */
export const DEMO_AGENT = { name: 'Alex Morgan', office: 'hph' };
export const agentProperties = () => DEMO_PROPERTIES.filter((p) => p.agentName === DEMO_AGENT.name);

export function demoProperty(id) {
  return DEMO_PROPERTIES.find((p) => p.id === id) || null;
}

/** The co-brand partner for a listing ({ name, shortName, navy, blue, logo, logoColour }) or null for Premarket only. */
export function partnerFor(property) {
  const office = property?.office ? OFFICES[property.office] : null;
  if (!office) return null;
  const { name, shortName, navy, blue, logo, logoColour } = office;
  return { name, shortName: shortName || name, navy, blue, logo: logo || null, logoColour: logoColour || null };
}

/** The existing property-specific slider range (vendor price ± 25%, $10,000 steps) via the shared helper. */
export function opinionRangeFor(property) {
  return computePriceOpinionRange(property);
}

export const addressLine = (p) => `${p.street}, ${p.suburb} ${p.state} ${p.postcode}`;

/**
 * Brand colours for a listing, as the CSS custom properties the existing buyer components already read
 * (--brand-primary etc., see utils/brandStyle.js). Premarket only: the existing Premarket defaults.
 */
export function brandStyleFor(property) {
  const partner = partnerFor(property);
  if (!partner) {
    return { '--brand-primary': '#c2410c', '--brand-primary-dark': '#9a3412', '--brand-text-on-primary': '#ffffff', '--brand-accent': '#e48900' };
  }
  return { '--brand-primary': partner.navy, '--brand-primary-dark': partner.navy, '--brand-text-on-primary': '#ffffff', '--brand-accent': partner.blue };
}
