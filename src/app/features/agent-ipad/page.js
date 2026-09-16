import AgentIpadClient from './AgentIpadClient';

export const metadata = {
  title: 'Agent iPad Kiosk — Capture Buyer Feedback in the Field | Premarket',
  description:
    'A kiosk mode for real estate agents, built for the open home. Opens in Safari on any iPad — no app to install. Capture buyer price opinions in person.',
  keywords: [
    'real estate ipad kiosk',
    'open home feedback ipad',
    'real estate field tool',
    'premarket agent kiosk',
  ],
  alternates: { canonical: 'https://premarket.homes/features/agent-ipad' },
  openGraph: {
    title: 'Agent iPad Kiosk | Premarket',
    description:
      'Capture buyer feedback in person. Opens in Safari — nothing to install.',
    url: 'https://premarket.homes/features/agent-ipad',
    type: 'website',
  },
};

export default function AgentIpadPage() {
  return <AgentIpadClient />;
}
