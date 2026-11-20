import OfficeLanding from '../components/office-landing/OfficeLanding';
import { BRANDED_PAGES } from '../components/office-landing/offices';
import { officeLandingMetadata } from '../components/office-landing/landingMeta';

// The /hph vendor page for Harcourts Inner East: same component and content, Inner East name + logo (see BRANDED_PAGES).
const office = BRANDED_PAGES.harcourtsinnereast;

export const metadata = officeLandingMetadata(office, '/harcourtsinnereast');

export const viewport = { themeColor: office.navy };

export default function HarcourtsInnerEastPage() {
  return <OfficeLanding office={office} />;
}
