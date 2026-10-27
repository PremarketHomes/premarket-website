// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';

const authFetch = vi.fn();
vi.mock('../../src/app/utils/authFetch', () => ({ authFetch: (...a) => authFetch(...a) }));

import XeroReadinessPanel from '../../src/app/dashboard/admin/invoicing/components/XeroReadinessPanel';

const okResult = {
  connected: true, readOnly: true, ready: true, blockers: [], warnings: ['Old diagnostic test records: 1 test invoice found'],
  checkedAt: '2026-11-01T00:00:00.000Z',
  checks: [
    { id: 'organisation', label: 'Connection and organisation', status: 'pass', detail: 'Connected to "Premarket Group Pty Ltd". Confirm this is the Premarket organisation.' },
    { id: 'leftovers', label: 'Old diagnostic test records', status: 'warn', detail: '1 test invoice found (all drafts).', cleanup: ['In Xero: delete the draft.', 'Do NOT authorise or send any of them. Premarket never does.'] },
  ],
};
const respond = (status, body) => authFetch.mockResolvedValue({ status, ok: status < 400, json: async () => body });

beforeEach(() => { vi.clearAllMocks(); window.confirm = vi.fn(() => true); });
afterEach(cleanup);

describe('XeroReadinessPanel', () => {
  it('NEVER contacts the server on load — nothing runs until the admin presses the button', () => {
    render(React.createElement(XeroReadinessPanel));
    expect(authFetch).not.toHaveBeenCalled();
    expect(screen.getByText(/Read-only/i)).toBeTruthy();
    expect(screen.getByText(/Creates and sends nothing/i)).toBeTruthy();
  });

  it('asks for confirmation first; cancelling does nothing', async () => {
    window.confirm = vi.fn(() => false);
    render(React.createElement(XeroReadinessPanel));
    fireEvent.click(screen.getByRole('button', { name: /run check/i }));
    expect(window.confirm).toHaveBeenCalledTimes(1);
    expect(window.confirm.mock.calls[0][0]).toMatch(/only READS from Xero/);
    expect(authFetch).not.toHaveBeenCalled();
  });

  it('after confirming, POSTs confirm:true to the readiness route and shows the results and cleanup steps', async () => {
    respond(200, okResult);
    render(React.createElement(XeroReadinessPanel));
    fireEvent.click(screen.getByRole('button', { name: /run check/i }));
    await screen.findByTestId('xero-readiness-result');
    expect(authFetch).toHaveBeenCalledTimes(1);
    const [url, init] = authFetch.mock.calls[0];
    expect(url).toBe('/api/admin/invoicing/xero-readiness');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toEqual({ confirm: true });
    expect(screen.getByText(/Ready: no blockers found/)).toBeTruthy();
    expect(screen.getByText(/1 warning/)).toBeTruthy();
    expect(screen.getByText(/Connected to "Premarket Group Pty Ltd"/)).toBeTruthy();
    expect(screen.getByText(/Do NOT authorise or send/)).toBeTruthy();
  });

  it('shows blockers clearly when not ready', async () => {
    respond(200, { ...okResult, ready: false, blockers: ['x'], warnings: [], checks: [{ id: 'account', label: 'Account code 200', status: 'fail', detail: 'No account with code 200 exists.' }] });
    render(React.createElement(XeroReadinessPanel));
    fireEvent.click(screen.getByRole('button', { name: /run check/i }));
    expect(await screen.findByText(/Not ready: 1 blocker/)).toBeTruthy();
    expect(screen.getByText(/No account with code 200 exists/)).toBeTruthy();
  });

  it('explains when the check is switched off (404) rather than failing silently', async () => {
    respond(404, { error: 'The Xero readiness check is disabled' });
    render(React.createElement(XeroReadinessPanel));
    fireEvent.click(screen.getByRole('button', { name: /run check/i }));
    expect((await screen.findByRole('alert')).textContent).toMatch(/switched off/);
  });

  it('shows "not connected" without error noise', async () => {
    respond(200, { connected: false, ready: false });
    render(React.createElement(XeroReadinessPanel));
    fireEvent.click(screen.getByRole('button', { name: /run check/i }));
    expect(await screen.findByText(/Xero is not connected/)).toBeTruthy();
  });

  it('surfaces a server error and re-enables the button', async () => {
    respond(500, { error: 'The readiness check failed' });
    render(React.createElement(XeroReadinessPanel));
    fireEvent.click(screen.getByRole('button', { name: /run check/i }));
    expect((await screen.findByRole('alert')).textContent).toMatch(/failed/);
    await waitFor(() => expect(screen.getByRole('button', { name: /run check/i }).disabled).toBe(false));
  });

  it('is wired into the admin settings only when Xero is connected, and is not auto-run there', async () => {
    const fs = await import('node:fs');
    const src = fs.readFileSync('src/app/dashboard/admin/invoicing/components/InvoicingSettings.js', 'utf-8');
    expect(src).toContain('{xeroConnected && <XeroReadinessPanel />}');
  });
});
