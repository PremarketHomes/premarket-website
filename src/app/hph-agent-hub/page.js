import AgentHub from '../components/office-landing/AgentHub';
import { OFFICES } from '../components/office-landing/offices';

const office = OFFICES.hph;
const url = 'https://premarket.homes/hph-agent-hub';
const title = `${office.name} | Agent Hub`;
const description =
  'Win the listing. Understand your buyers. Educate your vendors. An internal resource for Harcourts Property Hub agents.';

export const metadata = {
  title: { absolute: title },
  description,
  alternates: { canonical: url },
  // Internal HPH agent resource; not intended as a search landing page.
  robots: { index: false, follow: false },
  openGraph: { title, description, url, siteName: office.name, type: 'website', locale: 'en_AU' },
  twitter: { card: 'summary_large_image', title, description },
};

export const viewport = { themeColor: office.navy };

export default function HphAgentHubPage() {
  return <AgentHub office={office} />;
}
