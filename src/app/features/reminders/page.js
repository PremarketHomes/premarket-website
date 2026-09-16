import RemindersClient from './RemindersClient';

export const metadata = {
  title: 'Reminders — Campaign Check-ins | Premarket',
  description:
    'Premarket emails you a check-in at 14 and 30 days to see whether a property has sold — one less thing to track manually.',
  keywords: [
    'real estate campaign reminders',
    'listing follow up reminder',
  ],
  alternates: { canonical: 'https://premarket.homes/features/reminders' },
  openGraph: {
    title: 'Reminders — Campaign Check-ins | Premarket',
    description:
      'A simple scheduled check-in email at 14 and 30 days, sent to the agent.',
    url: 'https://premarket.homes/features/reminders',
    type: 'website',
  },
};

export default function RemindersPage() {
  return <RemindersClient />;
}
