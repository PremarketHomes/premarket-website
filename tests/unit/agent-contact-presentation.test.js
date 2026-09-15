import { describe, it, expect } from 'vitest';
import fs from 'node:fs';

function readAgentSignOff() {
  return fs.readFileSync(
    new URL('../../src/app/components/property-page/AgentSignOff.js', import.meta.url),
    'utf-8'
  );
}

describe('AgentSignOff — public contact presentation shows mobile only, never email', () => {
  it('never renders a mailto: link or references agentData.email', () => {
    const source = readAgentSignOff();
    expect(source).not.toContain('mailto:');
    expect(source).not.toContain('agentData.email');
  });

  it('still renders the agent\'s mobile number via the existing formatDisplayPhone helper', () => {
    const source = readAgentSignOff();
    expect(source).toContain('formatDisplayPhone');
    expect(source).toContain('tel:');
  });

  it('still shows the agent\'s photo, name, agency name and agency logo', () => {
    const source = readAgentSignOff();
    expect(source).toContain('agentData.avatar');
    expect(source).toContain('fullName');
    expect(source).toContain('agentData.companyName');
    expect(source).toContain('displayLogoUrl');
  });
});

describe('Removing public email presentation never touches authentication', () => {
  it('AgentSignOff.js does not import or call any Firebase Auth API', () => {
    const source = readAgentSignOff();
    expect(source).not.toMatch(/firebase\/auth/);
    expect(source).not.toMatch(/updateEmail|getAuth|signInWith/);
  });

  it('the agent-data fetch in PropertyPageClient.js still reads the users collection normally (email presentation change is display-only)', () => {
    const source = fs.readFileSync(
      new URL('../../src/app/components/PropertyPageClient.js', import.meta.url),
      'utf-8'
    );
    // The underlying Firestore user document / auth email itself is
    // untouched — this file just no longer copies `userData.email` into
    // the local agentData object used for public display.
    expect(source).not.toContain('email: userData.email');
    expect(source).toContain("doc(db, 'users', property.userId)");
  });
});

describe('Core submission logic is unchanged by this refinement round', () => {
  it('price opinions still write to the existing offers collection via the existing handlers', () => {
    const source = fs.readFileSync(
      new URL('../../src/app/components/PropertyPageClient.js', import.meta.url),
      'utf-8'
    );
    expect(source).toContain("collection(db, 'offers')");
    expect(source).toContain('const savePriceOpinion');
    expect(source).toContain('const handleContactSubmit');
    expect(source).toContain('const handleRegisterInterest');
  });
});
