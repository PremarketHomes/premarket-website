import { describe, it, expect } from 'vitest';
import { shouldShowMobilePrompt } from '../../src/app/utils/mobileConfirmation';

describe('shouldShowMobilePrompt', () => {
  it('shows the prompt for an existing agent with a phone number but no confirmation yet', () => {
    expect(shouldShowMobilePrompt({ agent: true, phone: '+61412345678' })).toBe(true);
  });

  it('shows the prompt for an existing agent with no phone number at all', () => {
    expect(shouldShowMobilePrompt({ agent: true })).toBe(true);
  });

  it('does not show the prompt once mobileConfirmedAt is set, regardless of phone presence', () => {
    expect(shouldShowMobilePrompt({ agent: true, phone: '+61412345678', mobileConfirmedAt: {} })).toBe(false);
    expect(shouldShowMobilePrompt({ agent: true, mobileConfirmedAt: {} })).toBe(false);
  });

  it('never shows the prompt to a non-agent (buyer) account', () => {
    expect(shouldShowMobilePrompt({ agent: false, roles: ['buyer'] })).toBe(false);
    expect(shouldShowMobilePrompt({})).toBe(false);
  });

  it('recognises isAgent as an equally valid agent flag', () => {
    expect(shouldShowMobilePrompt({ isAgent: true })).toBe(true);
  });

  it('is false for missing/null userData (still loading)', () => {
    expect(shouldShowMobilePrompt(null)).toBe(false);
    expect(shouldShowMobilePrompt(undefined)).toBe(false);
  });

  it('a newly-created agent (mobileConfirmedAt set at signup) is never prompted', () => {
    // Mirrors what /join/page.js now writes at account creation.
    const freshlyOnboardedAgent = {
      agent: true,
      phone: '+61412345678',
      mobileConfirmedAt: { seconds: 1700000000 },
    };
    expect(shouldShowMobilePrompt(freshlyOnboardedAgent)).toBe(false);
  });
});
