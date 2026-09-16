import PremarketExplainerClient from './PremarketExplainerClient';

export const metadata = {
  title: 'What is Premarket? — Real Buyer Evidence Before You List | Premarket',
  description:
    'Premarket is how Australian property gets tested before it goes to market — real, anonymous buyer evidence collected before you commit to a wider campaign.',
  keywords: [
    'what is premarket',
    'premarket australia',
    'sell house without open homes',
    'real buyer feedback',
    'private home sale australia',
  ],
  alternates: { canonical: 'https://premarket.homes/premarket' },
  openGraph: {
    title: 'What is Premarket? | Premarket',
    description:
      'No open homes required. Real buyer evidence before you commit to a wider campaign.',
    url: 'https://premarket.homes/premarket',
    type: 'website',
  },
};

export default function PremarketPage() {
  return <PremarketExplainerClient />;
}
