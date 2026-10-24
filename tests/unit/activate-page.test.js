// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';

const confirmPasswordReset = vi.fn();
const verifyPasswordResetCode = vi.fn();
const signInWithEmailAndPassword = vi.fn();
vi.mock('firebase/auth', () => ({
  confirmPasswordReset: (...a) => confirmPasswordReset(...a),
  verifyPasswordResetCode: (...a) => verifyPasswordResetCode(...a),
  signInWithEmailAndPassword: (...a) => signInWithEmailAndPassword(...a),
}));
vi.mock('../../src/app/firebase/clientApp', () => ({ auth: { name: 'auth' } }));
const authFetch = vi.fn();
vi.mock('../../src/app/utils/authFetch', () => ({ authFetch: (...a) => authFetch(...a) }));
vi.mock('next/navigation', () => ({ useSearchParams: () => new URLSearchParams('t=TOKEN-0123456789-abcdefghij') }));
vi.mock('next/image', () => ({ default: ({ alt }) => React.createElement('img', { alt }) }));
vi.mock('next/link', () => ({ default: ({ href, children, ...r }) => React.createElement('a', { href, ...r }, children) }));

const IPHONE_SAFARI = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';

let calls; // every request the page made to /api/office-activation
let responder;
const assign = vi.fn();

beforeEach(() => {
  calls = [];
  responder = (body) => {
    if (body.intent === 'continue') return [200, { oobCode: `code${calls.filter((c) => c.intent === 'continue').length}` }];
    return [200, { firstName: 'Sam', officeName: 'Harcourts Property Hub' }];
  };
  global.fetch = vi.fn(async (url, init) => {
    const body = JSON.parse(init.body);
    calls.push(body);
    const [status, json] = responder(body);
    return { ok: status < 400, status, json: async () => json };
  });
  confirmPasswordReset.mockReset().mockResolvedValue(undefined);
  verifyPasswordResetCode.mockReset().mockResolvedValue('sam@example.com');
  signInWithEmailAndPassword.mockReset().mockResolvedValue({});
  authFetch.mockReset().mockResolvedValue({});
  assign.mockReset();
  Object.defineProperty(window, 'location', { configurable: true, value: { assign } });
  Object.defineProperty(window.navigator, 'userAgent', { configurable: true, value: IPHONE_SAFARI });
});
afterEach(cleanup);

const mount = async () => {
  const Page = (await import('../../src/app/activate/page')).default;
  render(React.createElement(Page));
};
const fill = async (pw = 'Sup3r-secret-pw', confirm = pw) => {
  fireEvent.change(await screen.findByLabelText('New password'), { target: { value: pw } });
  fireEvent.change(screen.getByLabelText('Confirm password'), { target: { value: confirm } });
};
const submit = () => fireEvent.click(screen.getByRole('button', { name: /activate my account/i }));

describe('/activate on iPhone Safari', () => {
  it('REGRESSION: merely opening the page (even repeatedly — previews, scanners, tab restores) never requests a Firebase code', async () => {
    for (let i = 0; i < 3; i += 1) { await mount(); await screen.findByText(/welcome, sam/i); cleanup(); }
    expect(calls.length).toBe(3);
    expect(calls.every((c) => c.intent === undefined)).toBe(true);
    expect(confirmPasswordReset).not.toHaveBeenCalled();
  });

  it('greets the agent by name and office, with a password-manager friendly form', async () => {
    await mount();
    expect(await screen.findByText(/welcome, sam/i)).toBeTruthy();
    expect(screen.getByText('Harcourts Property Hub')).toBeTruthy();
    expect(screen.getByLabelText('New password').getAttribute('autocomplete')).toBe('new-password');
    expect(screen.getByLabelText('New password').getAttribute('type')).toBe('password');
  });

  it('sets the password with ONE fresh code, signs in, finalises activation and lands on the dashboard', async () => {
    await mount(); await fill(); submit();
    await waitFor(() => expect(assign).toHaveBeenCalledWith('/dashboard'));
    expect(calls.filter((c) => c.intent === 'continue')).toHaveLength(1);
    expect(confirmPasswordReset).toHaveBeenCalledWith({ name: 'auth' }, 'code1', 'Sup3r-secret-pw');
    expect(signInWithEmailAndPassword).toHaveBeenCalledWith({ name: 'auth' }, 'sam@example.com', 'Sup3r-secret-pw');
    expect(authFetch).toHaveBeenCalledWith('/api/offices/activate', { method: 'POST' });
  });

  it('a double tap on the button requests only one code', async () => {
    await mount(); await fill();
    const button = screen.getByRole('button', { name: /activate my account/i });
    fireEvent.click(button); fireEvent.click(button); fireEvent.click(button);
    await waitFor(() => expect(assign).toHaveBeenCalled());
    expect(calls.filter((c) => c.intent === 'continue')).toHaveLength(1);
  });

  it('REGRESSION: if Firebase rejects the code as stale/used, a fresh one is fetched automatically — no error screen', async () => {
    confirmPasswordReset.mockRejectedValueOnce(Object.assign(new Error('x'), { code: 'auth/invalid-action-code' }));
    await mount(); await fill(); submit();
    await waitFor(() => expect(assign).toHaveBeenCalledWith('/dashboard'));
    expect(calls.filter((c) => c.intent === 'continue')).toHaveLength(2);
    expect(confirmPasswordReset).toHaveBeenLastCalledWith({ name: 'auth' }, 'code2', 'Sup3r-secret-pw');
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('if it still fails after the automatic retry, the agent stays on a Premarket page with a clear next step', async () => {
    confirmPasswordReset.mockRejectedValue(Object.assign(new Error('x'), { code: 'auth/expired-action-code' }));
    await mount(); await fill(); submit();
    expect((await screen.findByRole('alert')).textContent).toMatch(/press the button again/i);
    expect(assign).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: /activate my account/i })).toBeTruthy(); // can retry
    expect(document.body.textContent).not.toMatch(/reset your password again|already been used/i);
  });

  it('validates locally first: short or mismatched passwords make no requests', async () => {
    await mount(); await fill('short', 'short'); submit();
    expect((await screen.findByRole('alert')).textContent).toMatch(/at least 8/i);
    await fill('Sup3r-secret-pw', 'different-pw'); submit();
    await waitFor(() => expect(screen.getByRole('alert').textContent).toMatch(/don’t match/i));
    expect(calls.filter((c) => c.intent === 'continue')).toHaveLength(0);
  });

  it('expired link: branded explanation with recovery options, no form', async () => {
    responder = () => [410, { error: 'This activation link has expired' }];
    await mount();
    expect(await screen.findByText(/invitation link has expired/i)).toBeTruthy();
    expect(screen.getByText(/ask your office administrator/i)).toBeTruthy();
    expect(screen.getByRole('link', { name: /go to sign in/i }).getAttribute('href')).toBe('/login');
    expect(screen.queryByLabelText('New password')).toBeNull();
  });

  it('replaced link and already-active account have their own clear messages', async () => {
    responder = () => [410, { error: 'This activation link has been replaced by a newer one' }];
    await mount();
    expect(await screen.findByText(/newer invitation has been sent/i)).toBeTruthy();
    cleanup();
    responder = () => [200, { alreadyActive: true }];
    await mount();
    expect(await screen.findByText(/already active/i)).toBeTruthy();
  });

  it('if the password was set but sign-in fails, falls back to the normal sign-in page', async () => {
    signInWithEmailAndPassword.mockRejectedValue(new Error('network'));
    await mount(); await fill(); submit();
    await waitFor(() => expect(assign).toHaveBeenCalledWith('/login?activated=1'));
  });

  it('support address shown is knockknock@premarket.homes', async () => {
    await mount(); await screen.findByText(/welcome, sam/i);
    expect(document.body.innerHTML).toContain('knockknock@premarket.homes');
    expect(document.body.innerHTML).not.toContain('hello@premarket.homes');
  });
});
