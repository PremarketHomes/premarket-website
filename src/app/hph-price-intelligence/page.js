import PriceIntelligenceLanding from '../components/office-landing/PriceIntelligenceLanding';
import { OFFICES } from '../components/office-landing/offices';

const office = OFFICES.hph;
const url = 'https://premarket.homes/hph-price-intelligence';
const title = `${office.name} | Price Intelligence`;
const description =
  'The market has changed. Collect meaningful buyer pricing opinions throughout the campaign to support earlier, evidence-based vendor conversations.';

export const metadata = {
  title: { absolute: title },
  description,
  alternates: { canonical: url },
  // Internal HPH rollout page; not intended as a search landing page.
  robots: { index: false, follow: false },
  openGraph: { title, description, url, siteName: office.name, type: 'website', locale: 'en_AU' },
  twitter: { card: 'summary_large_image', title, description },
};

export const viewport = { themeColor: office.navy };

export default function HphPriceIntelligencePage() {
  return <PriceIntelligenceLanding office={office} />;
}
