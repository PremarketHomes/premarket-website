import { playfairDisplay } from '../../components/property-page/fonts';

// Open Home Experience: a PROPOSED CONCEPT with demo data only (see docs/open-home-concept.md). Never indexed, never
// linked from navigation, and nothing in it reads or writes live Premarket data.
export const metadata = {
  title: { absolute: 'Open Home Experience · Concept | Premarket' },
  description: 'Proposed concept: a one-scan open-home check-in with anonymous price opinions.',
  robots: { index: false, follow: false, nocache: true, googleBot: { index: false, follow: false } },
  openGraph: null,
};

export default function OpenHomeConceptLayout({ children }) {
  return (
    <div className={`${playfairDisplay.variable} min-h-dvh bg-white text-slate-900 antialiased print:min-h-0`}>
      {children}
    </div>
  );
}
