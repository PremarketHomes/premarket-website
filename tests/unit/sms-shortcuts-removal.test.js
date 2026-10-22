import { describe, it, expect } from 'vitest';
import fs from 'node:fs';

// This project has no @testing-library/react / jsdom, and the Firestore
// emulator isn't runnable in this environment (no Java runtime) — so,
// matching the established pattern elsewhere (register-interest-flow.test.js,
// billing-creation-hooks.test.js), these are source-inspection checks: they
// read real files from disk and assert on their exact content, rather than
// executing the app or the rules engine.
//
// Together they verify the two things the SMS Shortcuts removal needed to
// guarantee: (1) every SMS-exclusive file/reference is actually gone, with
// no dangling import that would break the build, and (2) the PII exposure
// found in the audit (personal mobile numbers on the publicly-readable
// users/agents documents) can never be silently reintroduced without this
// test failing first.

function exists(relPath) {
  try {
    fs.statSync(new URL(relPath, import.meta.url));
    return true;
  } catch {
    return false;
  }
}

function read(relPath) {
  return fs.readFileSync(new URL(relPath, import.meta.url), 'utf-8');
}

function walkJsFiles(dirUrl) {
  const dir = dirUrl.pathname;
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = `${dir}/${entry.name}`;
    if (entry.isDirectory()) out.push(...walkJsFiles(new URL(`file://${full}/`)));
    else if (entry.name.endsWith('.js')) out.push(full);
  }
  return out;
}

describe('SMS Shortcuts removal — files actually gone', () => {
  const removedFiles = [
    '../../src/app/api/webhooks/twilio/sms/route.js',
    '../../src/app/api/services/twilioService.js',
    '../../src/app/api/services/smsHandlerService.js',
    '../../src/app/api/services/smsConversationService.js',
    '../../src/app/api/services/userLookupService.js',
    '../../src/app/api/services/propertyScrapeService.js',
    '../../src/app/api/users/sms-settings/route.js',
  ];

  it.each(removedFiles)('%s no longer exists', (relPath) => {
    expect(exists(relPath)).toBe(false);
  });

  it('the twilio npm package is no longer a dependency', () => {
    const pkg = JSON.parse(read('../../package.json'));
    expect(pkg.dependencies?.twilio).toBeUndefined();
    expect(pkg.devDependencies?.twilio).toBeUndefined();
  });
});

describe('SMS Shortcuts removal — no dangling references anywhere in src/app', () => {
  it('no file imports a deleted SMS service by path', () => {
    const files = walkJsFiles(new URL('../../src/app/', import.meta.url));
    const deletedPathFragments = [
      'propertyScrapeService',
      'smsHandlerService',
      'smsConversationService',
      'services/twilioService',
      'userLookupService',
      'sms-settings',
      'webhooks/twilio',
    ];
    const offenders = [];
    for (const file of files) {
      const content = fs.readFileSync(file, 'utf-8');
      for (const fragment of deletedPathFragments) {
        if (content.includes(fragment)) offenders.push(`${file}: ${fragment}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('no file writes smsPhone/smsEnabled to Firestore anywhere', () => {
    const files = walkJsFiles(new URL('../../src/app/', import.meta.url));
    const offenders = [];
    for (const file of files) {
      const content = fs.readFileSync(file, 'utf-8');
      if (/\bsmsPhone\b|\bsmsEnabled\b/.test(content)) offenders.push(file);
    }
    expect(offenders).toEqual([]);
  });

  it('the Account Settings page has no SMS Shortcuts card', () => {
    const source = read('../../src/app/dashboard/settings/page.js');
    expect(source).not.toContain('SMS Shortcuts');
    expect(source).not.toContain('TWILIO_PHONE_NUMBER');
  });

  it('AgentModal has no SMS enrollment fields', () => {
    const source = read('../../src/app/components/AgentModal.js');
    expect(source).not.toContain('SMS shortcuts');
    expect(source).not.toContain('smsPhoneInput');
  });

  it('the admin Users tab has no SMS column or editor', () => {
    const source = read('../../src/app/dashboard/admin/components/tabs/UsersTab.js');
    expect(source).not.toContain('SmsEditModal');
    expect(source).not.toContain('Add SMS');
  });

  it('the Team page has no SMS phone display', () => {
    const source = read('../../src/app/dashboard/agents/page.js');
    expect(source).not.toMatch(/smsPhone|smsEnabled/);
  });

  it('the admin users PATCH route no longer accepts smsPhone/smsEnabled', () => {
    const source = read('../../src/app/api/admin/users/route.js');
    expect(source).not.toMatch(/'smsPhone'|'smsEnabled'/);
  });

  it('the shared phone utility no longer exports the SMS-only phoneKey helper, but keeps the shared ones', () => {
    const source = read('../../src/app/utils/phone.js');
    expect(source).not.toContain('export function phoneKey');
    // Still shared with the unrelated mobile-confirmation flow and admin tooling.
    expect(source).toContain('export function normalizeE164');
    expect(source).toContain('export function formatDisplayPhone');
  });
});

describe('SMS Shortcuts removal — the PII exposure it leaves behind is documented and guarded', () => {
  it('firestore.rules explains why users/agents must never store a phone number again', () => {
    const rules = read('../../firestore.rules');
    // Slice from the section HEADER comment (which precedes the `match`
    // statement itself), not the `match` keyword, so the SECURITY note
    // living in that header comment is actually included.
    const usersBlock = rules.slice(rules.indexOf('// USERS'), rules.indexOf('match /properties/{propertyId}'));
    expect(usersBlock).toMatch(/SECURITY/);
    expect(usersBlock).toMatch(/cannot hide individual\s+fields|field-level restriction/i);

    const agentsBlock = rules.slice(rules.indexOf('// AGENTS'), rules.indexOf('match /draftProperties/{draftId}'));
    expect(agentsBlock).toMatch(/SECURITY/);
  });

  it('the users/agents update rules still have no path for a client to write smsPhone (unaffected by this change — it was never allowed)', () => {
    const rules = read('../../firestore.rules');
    const usersBlock = rules.slice(rules.indexOf('match /users/{userId}'), rules.indexOf('match /properties/{propertyId}'));
    expect(usersBlock).not.toMatch(/smsPhone|smsEnabled/);
  });

  it('a cleanup script exists to clear any already-stored smsPhone/smsEnabled values from production, and defaults to a dry run', () => {
    const source = read('../../scripts/cleanup-sms-fields.js');
    expect(source).toContain("const APPLY = process.argv.includes('--apply')");
    expect(source).toContain('users');
    expect(source).toContain('agents');
    expect(source).toContain("FieldValue.delete()");
  });
});
