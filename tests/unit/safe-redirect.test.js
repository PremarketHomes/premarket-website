import { describe, it, expect } from 'vitest';
import { getSafeReturnTo } from '../../src/app/utils/safeRedirect';

describe('getSafeReturnTo — open-redirect protection for login\'s returnTo param', () => {
  it('allows a plain relative path', () => {
    expect(getSafeReturnTo('/dashboard')).toBe('/dashboard');
  });

  it('allows a relative path with a query string (the office-invite use case)', () => {
    const value = '/office-invite?token=abc123';
    expect(getSafeReturnTo(value)).toBe(value);
  });

  it('returns null for empty/missing input', () => {
    expect(getSafeReturnTo('')).toBeNull();
    expect(getSafeReturnTo(null)).toBeNull();
    expect(getSafeReturnTo(undefined)).toBeNull();
  });

  it('SECURITY: rejects an absolute external URL', () => {
    expect(getSafeReturnTo('https://evil.example.com')).toBeNull();
    expect(getSafeReturnTo('http://evil.example.com/phish')).toBeNull();
  });

  it('SECURITY: rejects a protocol-relative URL (//evil.example.com)', () => {
    expect(getSafeReturnTo('//evil.example.com')).toBeNull();
  });

  it('SECURITY: rejects a value embedding an absolute URL anywhere in it', () => {
    expect(getSafeReturnTo('/ok?next=https://evil.example.com')).toBeNull();
  });

  it('SECURITY: rejects javascript: and other non-http(s) schemes', () => {
    expect(getSafeReturnTo('javascript:alert(1)')).toBeNull();
  });

  it('SECURITY: rejects a value containing a backslash (browser URL-normalization bypass)', () => {
    expect(getSafeReturnTo('/\\evil.example.com')).toBeNull();
    expect(getSafeReturnTo('/ok\\..\\evil')).toBeNull();
  });

  it('SECURITY: rejects a value that does not start with a slash', () => {
    expect(getSafeReturnTo('evil.example.com')).toBeNull();
    expect(getSafeReturnTo('dashboard')).toBeNull();
  });

  it('SECURITY: rejects a non-string value', () => {
    expect(getSafeReturnTo(123)).toBeNull();
    expect(getSafeReturnTo({})).toBeNull();
  });
});
