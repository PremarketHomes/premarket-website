import localFont from "next/font/local";
import { ModalProvider } from './context/ModalContext';
import { AuthProvider } from './context/AuthContext';
import Script from 'next/script';
import UploadStatusPanel from './components/UploadStatusPanel';

import "./globals.css";

// Fonts are self-hosted (src/app/fonts/, see README there) instead of next/font/google, which
// downloaded them from Google Fonts during every build: production builds failed whenever Google
// answered Vercel's build servers with a font URL format next/font cannot parse (Nov 2026).
// Same files (Google's latin subsets), weights, CSS variables and fallback sizing as before.
const poppins = localFont({
  src: [
    { path: './fonts/poppins-latin-400.woff2', weight: '400', style: 'normal' },
    { path: './fonts/poppins-latin-500.woff2', weight: '500', style: 'normal' },
    { path: './fonts/poppins-latin-600.woff2', weight: '600', style: 'normal' },
    { path: './fonts/poppins-latin-700.woff2', weight: '700', style: 'normal' },
    { path: './fonts/poppins-latin-800.woff2', weight: '800', style: 'normal' },
  ],
  variable: '--font-poppins',
  display: 'swap',
  preload: true,
  adjustFontFallback: 'Arial',
});

const inter = localFont({
  src: [{ path: './fonts/inter-latin-variable.woff2', weight: '400 800', style: 'normal' }],
  variable: '--font-inter',
  display: 'swap',
  preload: true,
  adjustFontFallback: 'Arial',
});

const antons = localFont({
  src: [{ path: './fonts/anton-latin-400.woff2', weight: '400', style: 'normal' }],
  variable: '--font-anton',
  display: 'swap',
  preload: true,
  adjustFontFallback: 'Arial',
});

export const metadata = {
  metadataBase: new URL('https://premarket.homes'),
  title: {
    default: "Premarket - Validate Property Prices with Real Buyer Feedback",
    template: "%s | Premarket"
  },
  description: "Premarket lets agents and homeowners validate property prices with real buyer feedback\u2014before or during a live listing\u2014so you attract stronger interest, build trust, and sell with confidence.",
  applicationName: 'Premarket',
  authors: [{ name: 'Premarket' }],
  generator: 'Next.js',
  keywords: ['premarket', 'property price validation', 'buyer feedback', 'australia property', 'real estate listings', 'property listings', 'real estate australia'],
  referrer: 'origin-when-cross-origin',
  creator: 'Premarket',
  publisher: 'Premarket',
  formatDetection: {
    email: false,
    address: false,
    telephone: false,
  },
  icons: {
    icon: '/iconFull.png',
    apple: '/apple.png',
  },
  openGraph: {
    title: "Premarket - Validate Property Prices with Real Buyer Feedback",
    description: "Premarket lets agents and homeowners validate property prices with real buyer feedback\u2014before or during a live listing\u2014so you attract stronger interest, build trust, and sell with confidence.",
    url: 'https://premarket.homes',
    siteName: 'Premarket',
    images: [
      {
        url: 'https://premarketvideos.b-cdn.net/assets/logo.png',
        width: 512,
        height: 512,
        alt: 'Premarket',
      },
    ],
    locale: 'en_AU',
    type: 'website',
  },
  twitter: {
    card: 'summary',
    title: "Premarket - Validate Property Prices with Real Buyer Feedback",
    description: "Premarket lets agents and homeowners validate property prices with real buyer feedback\u2014before or during a live listing\u2014so you attract stronger interest, build trust, and sell with confidence.",
    images: ['https://premarketvideos.b-cdn.net/assets/logo.png'],
  },
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <head>
        {/* Viewport and Mobile Meta Tags */}
        <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=5" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="default" />
        <meta name="apple-mobile-web-app-title" content="Premarket" />
        <meta name="mobile-web-app-capable" content="yes" />
        <meta name="theme-color" content="#e48900" />

        {/* Analytics queue, created before the page runs, so events pushed early (e.g. property_view on mount) wait in it
            and Google Tag Manager processes them when it loads. */}
        {/* Plain inline script (not next/script): it is in the server HTML and runs while the page is parsed. */}
        <script id="datalayer-init" dangerouslySetInnerHTML={{ __html: 'window.dataLayer = window.dataLayer || [];' }} />
        {/* Google Tag Manager: loaded when the browser is idle after the page has loaded (was straight after hydration),
            so its ~290 KB no longer competes with the page on mobile. Queued events are not lost. */}
        <Script id="google-tag-manager" strategy="lazyOnload">
          {`
            (function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':
            new Date().getTime(),event:'gtm.js'});var f=d.getElementsByTagName(s)[0],
            j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';j.async=true;j.src=
            'https://www.googletagmanager.com/gtm.js?id='+i+dl;f.parentNode.insertBefore(j,f);
            })(window,document,'script','dataLayer','GTM-PS65V87');
          `}
        </Script>
      </head>
      
      <body className={` antialiased bg-white`}>
        {/* Google Tag Manager (noscript) */}
        <noscript>
          <iframe 
            src="https://www.googletagmanager.com/ns.html?id=GTM-PS65V87"
            height="0" 
            width="0" 
            style={{ display: 'none', visibility: 'hidden' }}
          />
        </noscript>
        
        <AuthProvider>
          <ModalProvider>
            {children}
            <UploadStatusPanel />
          </ModalProvider>
        </AuthProvider>
      </body>
    </html>
  );
}