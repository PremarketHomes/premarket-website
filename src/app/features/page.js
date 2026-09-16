import FeaturesHubClient from './FeaturesHubClient';

export const metadata = {
  title: 'Features — Reports, Price Opinions, Agent iPad | Premarket',
  description:
    'What Premarket gives agents: vendor reports built from real buyer evidence, anonymous buyer price opinions, and a purpose-built field kiosk for the open home.',
  keywords: [
    'premarket features',
    'vendor report real estate',
    'price opinions software',
    'agent ipad kiosk',
  ],
  alternates: { canonical: 'https://premarket.homes/features' },
  openGraph: {
    title: 'Features — Reports, Price Opinions & Agent iPad | Premarket',
    description:
      'Vendor reports, anonymous buyer price opinions, and the Agent iPad kiosk.',
    url: 'https://premarket.homes/features',
    type: 'website',
  },
};

export default function FeaturesPage() {
  return <FeaturesHubClient />;
}
