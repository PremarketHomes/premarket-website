import { describe, it, expect } from 'vitest';
import { shouldShowStickyPrompt } from '../../src/app/utils/stickyPromptVisibility';

const baseline = {
  pastHero: true,
  priceCardInView: false,
  anyModalOpen: false,
  hasSubmittedOpinion: false,
};

describe('shouldShowStickyPrompt', () => {
  it('shows once past the hero, with the real card off-screen, nothing open, and no submission yet', () => {
    expect(shouldShowStickyPrompt(baseline)).toBe(true);
  });

  it('stays hidden while still inside the hero', () => {
    expect(shouldShowStickyPrompt({ ...baseline, pastHero: false })).toBe(false);
  });

  it('hides whenever the real price card is itself on screen — never both at once', () => {
    expect(shouldShowStickyPrompt({ ...baseline, priceCardInView: true })).toBe(false);
  });

  it('hides while any modal is open', () => {
    expect(shouldShowStickyPrompt({ ...baseline, anyModalOpen: true })).toBe(false);
  });

  it('hides for good once an opinion has been submitted this session', () => {
    expect(shouldShowStickyPrompt({ ...baseline, hasSubmittedOpinion: true })).toBe(false);
  });

  it('a returning visitor whose prior opinion was already restored is also treated as submitted', () => {
    // hasSubmittedOpinion is derived from savedOfferId in the caller,
    // which is true for a restored prior offer too — the rule itself
    // doesn't distinguish fresh vs restored, by design.
    expect(shouldShowStickyPrompt({ ...baseline, hasSubmittedOpinion: true })).toBe(false);
  });
});
