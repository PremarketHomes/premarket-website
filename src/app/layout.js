import { Poppins, Inter, Anton } from "next/font/google";
import { ModalProvider } from './context/ModalContext';
import { AuthProvider } from './context/AuthContext';
import Script from 'next/script';
import UploadStatusPanel from './components/UploadStatusPanel';

import "./globals.css";

const poppins = Poppins({
  weight: ['400', '500', '600', '700', '800'],
  subsets: ['latin'],
  variable: '--font-poppins',
  display: 'swap',
  preload: true,
});

const inter = Inter({
  weight: ['400', '500', '600', '700', '800'],
  subsets: ['latin'],
  variable: '--font-inter',
  display: 'swap',
  preload: true,
});

const antons = Anton({
  weight: ['400'],
  subsets: ['latin'],
  variable: '--font-anton',
  display: 'swap',
  preload: true,
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

        {/* Google Tag Manager */}
        <Script id="google-tag-manager" strategy="afterInteractive">
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