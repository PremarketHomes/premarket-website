import { TEAM_PAGES } from '../components/office-landing/offices';
import { officeLandingOgImage, OG_SIZE } from '../components/office-landing/landingOgImage';

export const alt = 'Mitch Harrop Team · Harcourts Property Hub × Premarket';
export const size = OG_SIZE;
export const contentType = 'image/png';

export default function Image() {
  return officeLandingOgImage(TEAM_PAGES.harropteam);
}
