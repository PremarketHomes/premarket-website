import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const page = readFileSync('src/app/components/PropertyPageClient.js', 'utf8');
const gallery = readFileSync('src/app/components/property-page/PropertyGallery.js', 'utf8');
const fetchProperty = page.slice(page.indexOf('const fetchProperty = async () => {'), page.indexOf('fetchProperty();'));

describe('buyer property page loading', () => {
  it('renders as soon as the property arrives; previous opinion and view count run in the background, together', () => {
    expect(fetchProperty.indexOf('setLoading(false);')).toBeLessThan(fetchProperty.indexOf('fetchPreviousOffer('));
    expect(fetchProperty).toContain('Promise.allSettled([');
    expect(fetchProperty).not.toMatch(/await fetchPreviousOffer|await incrementPropertyViews/);
    // the owner viewing their own listing still does not count as a view
    expect(fetchProperty).toContain('!currentUser || currentUser.uid !== data.userId ? incrementPropertyViews(propertyId) : null');
  });
  it('a late previous-opinion lookup never overwrites a value the visitor is already dragging', () => {
    const fn = page.slice(page.indexOf('const fetchPreviousOffer = async'), page.indexOf('const fetchOpinionCount = async'));
    expect(fn).toContain('const visitorHasTouchedSlider = firstInteractionTracked.current;');
    expect(fn.indexOf('setSavedOfferId(data.offerId);')).toBeLessThan(fn.indexOf('if (visitorHasTouchedSlider) return;')); // re-save still updates
    expect(fn.match(/if \(visitorHasTouchedSlider\) return;/g)).toHaveLength(2);
  });
  it('owner profile, roster agent and directory profile are requested together', () => {
    expect(page).toContain('fetchAgentProfiles([property.userId]), loadRosterAgent(), loadDirectoryAgent(),');
    expect(page).toContain('resolveListingAgent({ property, ownerProfile: userData, rosterAgent, directoryAgent })');
  });
  it('gallery tiles are resized copies sized to the tile; the lightbox and main photo are unchanged', () => {
    expect(gallery).toContain('unoptimized={!isOptimizableImageUrl(url)}');
    expect(gallery).toContain('sizes="(min-width: 640px) 340px, 78vw"');
    expect(readFileSync('src/app/components/property-page/PropertyHero.js', 'utf8')).toMatch(/priority\s+sizes="100vw"/);
  });
  it('the agent photo (64 px) is a resized copy, not the original upload', () => {
    const signOff = readFileSync('src/app/components/property-page/AgentSignOff.js', 'utf8');
    expect(signOff).toContain('unoptimized={!isOptimizableImageUrl(agentData.avatar)}');
  });
});
