import { playfairDisplay } from '../components/property-page/fonts';

// The page buyers open from an agent's Open Home QR code (pilot). Never indexed.
export const metadata = {
  title: { absolute: 'Open home check-in | Premarket' },
  robots: { index: false, follow: false, nocache: true, googleBot: { index: false, follow: false } },
  openGraph: null,
};

export default function OpenHomeLayout({ children }) {
  return <div className={`${playfairDisplay.variable} min-h-dvh bg-white text-slate-900 antialiased`}>{children}</div>;
}
