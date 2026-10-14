import { describe, it, expect } from 'vitest';
import { shouldShowPersistentSlider } from '../../src/app/utils/persistentSliderVisibility';

const baseline = {
  anyModalOpen: false,
  hasSubmittedOpinion: false,
};

describe('shouldShowPersistentSlider', () => {
  it('shows by default — nothing open, nothing submitted yet', () => {
    expect(shouldShowPersistentSlider(baseline)).toBe(true);
  });

  it('hides while any modal is open (confirm, qualification, signup, lightbox, video)', () => {
    expect(shouldShowPersistentSlider({ ...baseline, anyModalOpen: true })).toBe(false);
  });

  it('hides for good once an opinion has been submitted this session', () => {
    expect(shouldShowPersistentSlider({ ...baseline, hasSubmittedOpinion: true })).toBe(false);
  });

  it('never hides for scroll position — there is no such input to this function', () => {
    expect(shouldShowPersistentSlider(baseline)).toBe(true);
    expect(Object.keys(baseline)).toEqual(['anyModalOpen', 'hasSubmittedOpinion']);
  });
});
