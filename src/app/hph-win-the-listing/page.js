import WinTheListingLanding from '../components/office-landing/WinTheListingLanding';
import { OFFICES } from '../components/office-landing/offices';

const office = OFFICES.hph;
const url = 'https://premarket.homes/hph-win-the-listing';
const title = `${office.name} | Win the Listing`;
const description =
  'Give vendors a reason to choose you before they’re ready to sell: a lower-pressure first step for hesitant homeowners.';

export const metadata = {
  title: { absolute: title },
  description,
  alternates: { canonical: url },
  // Internal HPH agent education page; not intended as a search landing page.
  robots: { index: false, follow: false },
  openGraph: { title, description, url, siteName: office.name, type: 'website', locale: 'en_AU' },
  twitter: { card: 'summary_large_image', title, description },
};

export const viewport = { themeColor: office.navy };

export default function HphWinTheListingPage() {
  return <WinTheListingLanding office={office} />;
}
