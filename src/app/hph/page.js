import OfficeLanding from '../components/office-landing/OfficeLanding';
import { OFFICES } from '../components/office-landing/offices';

const office = OFFICES.hph;
const title = `${office.name} | Understand your property’s potential`;
const description =
  `${office.name} has partnered with Premarket so you can explore buyer interest and anonymous pricing opinions before you go to market.`;

export const metadata = {
  title: { absolute: title },
  description,
  alternates: { canonical: 'https://premarket.homes/hph' },
  // Shared privately by agents; not intended as a search landing page.
  robots: { index: false, follow: false },
  openGraph: { title, description, url: 'https://premarket.homes/hph', siteName: office.name, type: 'website', locale: 'en_AU' },
  twitter: { card: 'summary_large_image', title, description },
};

export const viewport = { themeColor: office.navy };

export default function HphPage() {
  return <OfficeLanding office={office} />;
}
