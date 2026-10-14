import { describe, it, expect } from 'vitest';
import { shouldShowValuationBar } from '../../src/app/utils/valuationBarVisibility';

const baseline = {
  heroInView: false,
  detailInView: false,
  anyModalOpen: false,
  hasSubmittedOpinion: false,
};

describe('shouldShowValuationBar', () => {
  it('shows once the hero (and its embedded slider) has scrolled away, with the lower recap off-screen, nothing open, and no submission yet', () => {
    expect(shouldShowValuationBar(baseline)).toBe(true);
  });

  it('stays hidden while the hero valuation bar is still in view — never two slider surfaces at once', () => {
    expect(shouldShowValuationBar({ ...baseline, heroInView: true })).toBe(false);
  });

  it('stays hidden while the lower recap section is in view', () => {
    expect(shouldShowValuationBar({ ...baseline, detailInView: true })).toBe(false);
  });

  it('hides while any modal is open (including qualification/signup, so it can never sit under the keyboard)', () => {
    expect(shouldShowValuationBar({ ...baseline, anyModalOpen: true })).toBe(false);
  });

  it('hides for good once an opinion has been submitted this session', () => {
    expect(shouldShowValuationBar({ ...baseline, hasSubmittedOpinion: true })).toBe(false);
  });

  it('a returning visitor whose prior opinion was already restored is also treated as submitted', () => {
    expect(shouldShowValuationBar({ ...baseline, hasSubmittedOpinion: true })).toBe(false);
  });
});
