import ReportsClient from './ReportsClient';

export const metadata = {
  title: 'Vendor Reports — Built from Real Buyer Evidence | Premarket',
  description:
    'Premarket reports reflect real buyer evidence the moment you open them — price opinion distribution and registered interest, in one beautifully formatted document you can share with vendors.',
  keywords: [
    'vendor report real estate',
    'property sales report',
    'real estate dashboard',
    'vendor reporting australia',
    'buyer feedback report',
  ],
  alternates: { canonical: 'https://premarket.homes/features/reports' },
  openGraph: {
    title: 'Vendor Reports | Premarket',
    description:
      'Reports built from real buyer evidence — beautifully formatted, ready to share.',
    url: 'https://premarket.homes/features/reports',
    type: 'website',
  },
};

export default function ReportsPage() {
  return <ReportsClient />;
}
