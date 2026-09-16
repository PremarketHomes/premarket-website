import AgentsClient from './AgentsClient';

export const metadata = {
  title: 'For Listing Agents — Win More Listings With Real Buyer Evidence | Premarket',
  description:
    'Walk into every appraisal with live buyer evidence in hand. Premarket campaigns let listing agents test the market privately, give vendors confidence, and convert more appraisals into listings — for a flat $200 vendor-paid campaign fee, no subscription.',
  keywords: [
    'real estate listing agents',
    'win more listings',
    'vendor report',
    'price discovery property',
    'premarket campaign',
    'real estate appraisal tool',
    'listing presentation tool australia',
  ],
  alternates: { canonical: 'https://premarket.homes/solutions/agents' },
  openGraph: {
    title: 'For Listing Agents — Win More Listings With Real Buyer Evidence | Premarket',
    description:
      'Walk into every appraisal with live buyer evidence in hand. Premarket helps listing agents win more listings, defend price, and look unmissably professional.',
    url: 'https://premarket.homes/solutions/agents',
    type: 'website',
  },
};

export default function AgentsPage() {
  return <AgentsClient />;
}
