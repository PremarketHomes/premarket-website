import AgentHub from '../components/office-landing/AgentHub';
import { BRANDED_PAGES } from '../components/office-landing/offices';

// The /hph-agent-hub page for Harcourts Inner East: same component and content, Inner East name + logo, and its
// Premarket tab links to the Inner East vendor page (/harcourtsinnereast). Public, like /hph-agent-hub: no sign-in needed.
const office = BRANDED_PAGES.harcourtsinnereast;
const url = 'https://premarket.homes/harcourtsinnereast-agent-hub';
const title = `${office.name} | Agent Hub`;
const description =
  `Win the listing. Understand your buyers. Educate your vendors. An internal resource for ${office.name} agents.`;

export const metadata = {
  title: { absolute: title },
  description,
  alternates: { canonical: url },
  // Internal agent resource; not intended as a search landing page.
  robots: { index: false, follow: false },
  openGraph: { title, description, url, siteName: office.name, type: 'website', locale: 'en_AU' },
  twitter: { card: 'summary_large_image', title, description },
};

export const viewport = { themeColor: office.navy };

export default function HarcourtsInnerEastAgentHubPage() {
  return <AgentHub office={office} />;
}
