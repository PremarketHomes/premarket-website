import OfficeLanding from '../components/office-landing/OfficeLanding';
import { OFFICES } from '../components/office-landing/offices';
import { officeLandingMetadata } from '../components/office-landing/landingMeta';

const office = OFFICES.hph;

export const metadata = officeLandingMetadata(office, '/hph');

export const viewport = { themeColor: office.navy };

export default function HphPage() {
  return <OfficeLanding office={office} />;
}
