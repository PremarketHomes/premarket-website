import DataMetricsClient from './DataMetricsClient';

// DORMANT: removed from active navigation, feature lists, CTAs and every
// other promoted surface (release audit — Data Metrics is not being
// marketed while it isn't a mainstream, agent-dashboard-accessible
// product surface). Route intentionally left in place rather than
// deleted. noindex so it isn't picked up/re-indexed by search engines
// while dormant and unlinked from the rest of the public site.
export const metadata = {
  title: 'PHI Data Metrics — Eight Suburb Indicators | Premarket',
  description:
    'The Premarket Health Indicators (PHI) are eight indicators computed daily from real buyer activity — price opinions, registered interest and engagement — not historical settlements.',
  alternates: { canonical: 'https://premarket.homes/features/data-metrics' },
  robots: {
    index: false,
    follow: false,
  },
};

export default function DataMetricsPage() {
  return <DataMetricsClient />;
}
