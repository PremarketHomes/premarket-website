import OfficeLanding from '../components/office-landing/OfficeLanding';
import { TEAM_PAGES } from '../components/office-landing/offices';
import { officeLandingMetadata } from '../components/office-landing/landingMeta';

// The /hph vendor page for the Mitch Harrop Team: same component and content, team accent + name (see TEAM_PAGES).
// Also served at /Harropteam (next.config.mjs rewrite).
const office = TEAM_PAGES.harropteam;

export const metadata = officeLandingMetadata(office, '/Harropteam');

export const viewport = { themeColor: office.navy };

export default function HarropTeamPage() {
  return <OfficeLanding office={office} />;
}
