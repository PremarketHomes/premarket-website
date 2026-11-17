import { OFFICES } from '../components/office-landing/offices';
import { officeLandingOgImage, OG_SIZE } from '../components/office-landing/landingOgImage';

export const alt = 'Harcourts Property Hub × Premarket';
export const size = OG_SIZE;
export const contentType = 'image/png';

export default function Image() {
  return officeLandingOgImage(OFFICES.hph);
}
