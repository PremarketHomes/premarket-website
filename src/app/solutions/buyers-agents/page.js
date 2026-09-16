import BuyersAgentsClient from './BuyersAgentsClient';

export const metadata = {
  title: "For Buyer's Agents — Price Opinions & Interest | Premarket",
  description:
    "When a listing agent shares a Premarket property with you, submit an anonymous price opinion or register interest on behalf of your client — the same tools every buyer has.",
  keywords: [
    "buyers agent australia",
    "off market property buyers agent",
    "premarket property listings",
  ],
  alternates: { canonical: 'https://premarket.homes/solutions/buyers-agents' },
  openGraph: {
    title: "For Buyer's Agents — Price Opinions & Interest | Premarket",
    description:
      "The same anonymous price-opinion and registered-interest tools every buyer has, informed by your professional judgement.",
    url: 'https://premarket.homes/solutions/buyers-agents',
    type: 'website',
  },
};

export default function BuyersAgentsPage() {
  return <BuyersAgentsClient />;
}
