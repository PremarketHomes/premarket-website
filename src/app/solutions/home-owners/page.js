import HomeOwnersClient from './HomeOwnersClient';

export const metadata = {
  title: 'For Home Owners — Test the Market Privately | Premarket',
  description:
    'Find out what real buyers would pay for your home before you commit to a wider marketing campaign. Talk to your local agent about a private Premarket campaign.',
  keywords: [
    'sell home privately australia',
    'test market before listing',
    'off market home selling',
    'no open homes',
    'real buyer feedback house price',
    'premarket campaign vendor',
  ],
  alternates: { canonical: 'https://premarket.homes/solutions/home-owners' },
  openGraph: {
    title: 'For Home Owners — Test the Market Privately | Premarket',
    description:
      'Get real buyer evidence before you list. No open homes required, no public footprint.',
    url: 'https://premarket.homes/solutions/home-owners',
    type: 'website',
  },
};

export default function HomeOwnersPage() {
  return <HomeOwnersClient />;
}
