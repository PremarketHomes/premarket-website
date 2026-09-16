import DataMetricsClient from './DataMetricsClient';

export const metadata = {
  title: 'PHI Data Metrics — Eight Suburb Indicators | Premarket',
  description:
    'The Premarket Health Indicators (PHI) are eight indicators computed daily from real buyer activity — price opinions, registered interest and engagement — not historical settlements.',
  keywords: [
    'premarket health indicators',
    'phi metrics real estate',
    'real estate data analytics australia',
    'suburb scoring',
    'buyer demand data',
  ],
  alternates: { canonical: 'https://premarket.homes/features/data-metrics' },
  openGraph: {
    title: 'PHI Data Metrics — Eight Suburb Indicators | Premarket',
    description:
      'Suburb indicators built from real buyer evidence, not historical settlements.',
    url: 'https://premarket.homes/features/data-metrics',
    type: 'website',
  },
};

export default function DataMetricsPage() {
  return <DataMetricsClient />;
}
