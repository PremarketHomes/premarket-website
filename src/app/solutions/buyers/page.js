import BuyersClient from './BuyersClient';

export const metadata = {
  title: 'For Buyers — Price Opinions & Registering Interest | Premarket',
  description:
    'When an agent shares a property with you through Premarket, share an honest price opinion and register genuine interest — no account required.',
  keywords: [
    'buyer price opinions',
    'register interest property',
    'anonymous property price opinion',
    'premarket buyer experience',
  ],
  alternates: { canonical: 'https://premarket.homes/solutions/buyers' },
  openGraph: {
    title: 'For Buyers — Price Opinions & Registering Interest | Premarket',
    description:
      'When an agent shares a property with you through Premarket, share an honest price opinion and register genuine interest — no account required.',
    url: 'https://premarket.homes/solutions/buyers',
    type: 'website',
  },
};

export default function BuyersPage() {
  return <BuyersClient />;
}
