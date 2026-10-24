// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { PLACEHOLDER_AVATAR_URL, getInitials, isPlaceholderAvatar } from '../../src/app/utils/avatar';

vi.mock('next/link', () => ({ default: ({ href, children, ...r }) => React.createElement('a', { href, ...r }, children) }));
vi.mock('lucide-react', () => ({ User: () => React.createElement('svg', { 'data-testid': 'user-icon' }) }));

afterEach(cleanup);
const load = async () => (await import('../../src/app/dashboard/components/AgentGreeting')).default;
const show = async (props) => { const G = await load(); return render(React.createElement(G, props)); };
const photo = 'https://cdn.example.com/sam.jpg';

describe('AgentGreeting (mobile dashboard)', () => {
  it('shows the stored profile photo beside "Welcome back, <first name>"', async () => {
    const { container } = await show({ userData: { firstName: 'Sam', lastName: 'Wilson', avatar: photo } });
    expect(container.querySelector('img').getAttribute('src')).toBe(photo);
    expect(container.querySelector('img').className).toMatch(/rounded-full/);
    expect(container.textContent).toMatch(/Welcome back, Sam/);
    expect(container.textContent).not.toMatch(/Wilson/); // first name only
  });

  it('office-linked agent: office name shown underneath', async () => {
    await show({ userData: { firstName: 'Sam', avatar: photo, officeId: 'o1' }, officeName: 'Harcourts Property Hub', officeStatus: 'ready' });
    expect(screen.getByText('Harcourts Property Hub')).toBeTruthy();
    expect(screen.queryByText(/add agency details/i)).toBeNull();
  });

  it('office name still loading: a placeholder holds the space; failed to load: line omitted, greeting unaffected', async () => {
    const { container, rerender } = await show({ userData: { firstName: 'Sam', officeId: 'o1' }, officeName: null, officeStatus: 'loading' });
    expect(screen.getByLabelText('Loading office')).toBeTruthy();
    const G = await load();
    rerender(React.createElement(G, { userData: { firstName: 'Sam', officeId: 'o1' }, officeName: null, officeStatus: 'failed' }));
    expect(screen.queryByLabelText('Loading office')).toBeNull();
    expect(container.textContent).toBe('S' + 'Welcome back, Sam'); // initial + greeting only, no error text
  });

  it('no photo -> polished initials avatar', async () => {
    await show({ userData: { firstName: 'Sam', lastName: 'Wilson' } });
    expect(screen.getByTestId('initials-avatar').textContent).toBe('SW');
  });

  it('the account-creation placeholder image counts as "no photo"', async () => {
    const { container } = await show({ userData: { firstName: 'Sam', lastName: 'Wilson', avatar: PLACEHOLDER_AVATAR_URL } });
    expect(container.querySelector('img')).toBeNull();
    expect(screen.getByTestId('initials-avatar').textContent).toBe('SW');
  });

  it('a photo that fails to load falls back to initials', async () => {
    const { container } = await show({ userData: { firstName: 'Sam', lastName: 'Wilson', avatar: photo } });
    fireEvent.error(container.querySelector('img'));
    expect(container.querySelector('img')).toBeNull();
    expect(screen.getByTestId('initials-avatar').textContent).toBe('SW');
  });

  it('independent agent without an agency keeps the "Add agency details" link; with one, no extra line', async () => {
    await show({ userData: { firstName: 'Sam', avatar: photo } });
    expect(screen.getByText(/add agency details/i).getAttribute('href')).toBe('/dashboard/settings');
    cleanup();
    const { container } = await show({ userData: { firstName: 'Sam', avatar: photo, companyName: 'Acme Realty' } });
    expect(container.textContent).not.toMatch(/agency details|Acme/);
  });

  it('copes with a missing name', async () => {
    const { container } = await show({ userData: {} });
    expect(container.textContent).toMatch(/Welcome back/);
    expect(screen.getByTestId('user-icon')).toBeTruthy();
  });
});

describe('avatar helpers', () => {
  it('initials', () => {
    expect(getInitials('sam', 'wilson')).toBe('SW');
    expect(getInitials(' Sam ', '')).toBe('S');
    expect(getInitials()).toBe('');
  });
  it('placeholder detection', () => {
    expect(isPlaceholderAvatar(undefined)).toBe(true);
    expect(isPlaceholderAvatar(PLACEHOLDER_AVATAR_URL)).toBe(true);
    expect(isPlaceholderAvatar('https://x/y.jpg')).toBe(false);
  });
});
