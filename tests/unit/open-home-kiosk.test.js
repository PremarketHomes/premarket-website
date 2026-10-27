// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import fs from 'node:fs';
import { render, screen, fireEvent, waitFor, cleanup, act } from '@testing-library/react';

// ── fake server behind the real queue ─────────────────────────────────────
const server = { docs: {}, writes: [], notified: [], online: true, hang: false };
const memory = new Map();
let generation = 0; // a torn-down kiosk from an earlier test must never touch a later test's storage
const makeStorage = () => {
  const g = generation;
  return {
    getItem: (k) => (g === generation ? (memory.get(k) ?? null) : null),
    setItem: (k, v) => { if (g === generation) memory.set(k, v); },
    removeItem: (k) => { if (g === generation) memory.delete(k); },
  };
};

vi.mock('firebase/firestore', () => ({ doc: vi.fn(), setDoc: vi.fn(), serverTimestamp: () => 'TS', Timestamp: { fromDate: (d) => d } }));
vi.mock('../../src/app/firebase/clientApp', () => ({ db: {} }));
vi.mock('../../src/app/utils/kioskPersistence', async (importOriginal) => {
  const real = await importOriginal();
  return {
    ...real,
    safeLocalStorage: () => makeStorage(),
    writeKioskItem: async (item) => {
      server.writes.push({ docId: item.docId, data: item.data });
      if (server.hang) return new Promise(() => {});
      if (!server.online) throw new Error('offline');
      server.docs[item.docId] = { ...(server.docs[item.docId] || {}), ...item.data };
    },
    notifyKioskItem: async (item) => {
      if (!server.online) throw new Error('offline');
      server.notified.push(item.docId);
    },
  };
});
vi.mock('next/image', () => ({
  default: ({ src, alt, fill, priority, unoptimized, sizes, ...rest }) => React.createElement('img', { src, alt, ...rest }),
}));

import OpenHomeKiosk from '../../src/app/components/kiosk/OpenHomeKiosk';

const FAST = { settleMs: 120, thanksMs: 600, thanksLockMs: 60, modalIdleMs: 500, exitHoldMs: 300, queuedAfterMs: 150 };
const base = {
  propertyId: 'prop1', title: 'Beach House', addressLine: '1 Greenwich Avenue, Pimpama QLD',
  imageUrl: 'https://img.test/house.jpg', agentName: 'Phil Chillemi', companyName: 'Harcourts Property Hub',
  logoUrl: 'https://img.test/hph-logo.png', avatarUrl: 'https://img.test/phil.jpg',
  brandStyle: { '--brand-primary': '#0a5', '--brand-primary-dark': '#083' }, minPrice: 800000, maxPrice: 1200000, step: 10000,
  timing: FAST, getVisitorId: () => 'v_kiosk',
};

beforeEach(() => {
  generation += 1;
  server.docs = {}; server.writes = []; server.notified = []; server.online = true; server.hang = false;
  memory.clear();
  Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
  // 1000px-wide track starting at x=0 => clientX maps linearly to price
  Element.prototype.getBoundingClientRect = () => ({ left: 0, top: 0, right: 1000, bottom: 20, width: 1000, height: 20, x: 0, y: 0, toJSON() {} });
  Element.prototype.setPointerCapture = vi.fn();
  Element.prototype.releasePointerCapture = vi.fn();
});
afterEach(cleanup);

const mount = (props = {}) => render(React.createElement(OpenHomeKiosk, { ...base, ...props }));
const slider = () => screen.getByRole('slider');
const pe = (type, init) => ({ pointerId: 1, pointerType: 'touch', button: 0, isPrimary: true, ...init });

// Baseline is the midpoint ($1,000,000) => thumb at x=500. clientX 800 => $1,120,000 (rounded to $10k)
async function drag(to = 800, { release = true, pointerId = 1 } = {}) {
  fireEvent.pointerDown(slider(), pe('down', { clientX: 500, pointerId }));
  fireEvent.pointerMove(slider(), pe('move', { clientX: (500 + to) / 2, pointerId }));
  fireEvent.pointerMove(slider(), pe('move', { clientX: to, pointerId }));
  if (release) fireEvent.pointerUp(slider(), pe('up', { clientX: to, pointerId }));
}
const opinionWrites = () => server.writes.filter((w) => !w.data.serious);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

describe('one beautiful full-screen page', () => {
  it('shows the photo, address, office branding, assurance copy, slider, Register interest and subtle Premarket branding', () => {
    mount();
    expect(screen.getByText('1 Greenwich Avenue, Pimpama QLD')).toBeTruthy();
    expect(screen.getByAltText('Harcourts Property Hub').getAttribute('src')).toBe('https://img.test/hph-logo.png');
    expect(document.querySelector('img[src="https://img.test/house.jpg"]')).toBeTruthy();
    expect(screen.getByText(/Anonymous — no name, no sign-up\./)).toBeTruthy();
    expect(screen.getByText(/helps guide the owner/i)).toBeTruthy();
    expect(screen.getByText('Phil Chillemi')).toBeTruthy();
    expect(screen.getByRole('button', { name: /register interest/i })).toBeTruthy();
    expect(screen.getByAltText('Premarket')).toBeTruthy();
    expect(screen.getByTestId('open-home-kiosk').style.getPropertyValue('--brand-primary')).toBe('#0a5');
  });

  it('has no welcome screen, next, submit, confirm or lock-in button for the anonymous opinion', () => {
    mount();
    const names = screen.getAllByRole('button').map((b) => b.textContent.toLowerCase());
    expect(names).toEqual(['register interest']);
    for (const banned of ['next', 'submit', 'lock in', 'confirm', 'continue', 'start', 'welcome']) {
      expect(names.some((n) => n.includes(banned))).toBe(false);
    }
  });

  it('does not anchor the buyer: no price is shown until they move the slider', () => {
    mount();
    expect(screen.getByText(/what do you think it.s worth/i)).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/\$1,000,000/);
  });

  it('works without a logo or photo (independent agent) and still reads cleanly', () => {
    mount({ logoUrl: null, imageUrl: null, avatarUrl: null, companyName: 'Evolve Sales & Management' });
    expect(screen.getByText('Evolve Sales & Management')).toBeTruthy();
    expect(screen.getByRole('slider')).toBeTruthy();
  });

  it('is accessible: slider semantics, a live status region, and a labelled dialog', async () => {
    mount();
    const s = slider();
    expect(s.getAttribute('aria-valuemin')).toBe('800000');
    expect(s.getAttribute('aria-valuemax')).toBe('1200000');
    expect(s.getAttribute('aria-valuenow')).toBe('1000000');
    expect(s.getAttribute('aria-valuetext')).toBe('$1,000,000');
    expect(s.getAttribute('aria-label')).toMatch(/price opinion/i);
    expect(s.tabIndex).toBe(0);
    expect(document.querySelector('[role="status"][aria-live="polite"]')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /register interest/i }));
    const dialog = await screen.findByRole('dialog');
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(dialog.getAttribute('aria-labelledby')).toBe('kiosk-register-title');
  });

  it('locks page scrolling while mounted and restores it on exit', () => {
    document.body.style.overflow = 'auto';
    const { unmount } = mount();
    expect(document.body.style.overflow).toBe('hidden');
    unmount();
    expect(document.body.style.overflow).toBe('auto');
  });
});

describe('slider release records one anonymous opinion — deliberately', () => {
  it('drag + release saves exactly one anonymous opinion after the settling window, with an idempotent id', async () => {
    mount();
    await drag(800);
    expect(opinionWrites()).toHaveLength(0);              // not yet: still settling
    await waitFor(() => expect(opinionWrites()).toHaveLength(1));
    const w = opinionWrites()[0];
    expect(w.docId).toMatch(/^[A-Za-z0-9]{20}$/);
    expect(w.data).toMatchObject({ type: 'opinion', propertyId: 'prop1', offerAmount: 1120000, fromWeb: true, fromIpadMode: true, visitorId: 'v_kiosk' });
    expect(w.data.sessionId).toMatch(/^ipad_/);
    expect('userId' in w.data).toBe(false);
    expect('buyerEmail' in w.data).toBe(false);          // anonymous
    await wait(300);
    expect(opinionWrites()).toHaveLength(1);              // never saved twice
  });

  it('a tap or brush that does not move the slider records nothing', async () => {
    mount();
    fireEvent.pointerDown(slider(), pe('down', { clientX: 500 }));
    fireEvent.pointerUp(slider(), pe('up', { clientX: 500 }));
    fireEvent.pointerDown(slider(), pe('down', { clientX: 100 }));   // quick tap on the track, away from the thumb
    fireEvent.pointerUp(slider(), pe('up', { clientX: 100 }));
    await wait(400);
    expect(server.writes).toHaveLength(0);
  });

  it('a touch the system cancels (pointercancel) saves nothing', async () => {
    mount();
    await drag(800, { release: false });
    fireEvent.pointerCancel(slider(), pe('cancel', { clientX: 800 }));
    await wait(400);
    expect(server.writes).toHaveLength(0);
    expect(screen.getByText(/what do you think it.s worth/i)).toBeTruthy();
  });

  it('a second finger is ignored', async () => {
    mount();
    await drag(800, { release: false });
    fireEvent.pointerDown(slider(), pe('down', { clientX: 200, pointerId: 2 }));
    fireEvent.pointerMove(slider(), pe('move', { clientX: 300, pointerId: 2 }));
    fireEvent.pointerUp(slider(), pe('up', { clientX: 300, pointerId: 2 }));
    fireEvent.pointerUp(slider(), pe('up', { clientX: 800, pointerId: 1 }));
    await waitFor(() => expect(opinionWrites()).toHaveLength(1));
    expect(opinionWrites()[0].data.offerAmount).toBe(1120000);
  });

  it('duplicate release events (touchend + emulated mouseup style) save once', async () => {
    mount();
    await drag(800);
    fireEvent.pointerUp(slider(), pe('up', { clientX: 800 }));
    fireEvent.pointerUp(slider(), pe('up', { clientX: 800 }));
    await waitFor(() => expect(opinionWrites()).toHaveLength(1));
    await wait(300);
    expect(opinionWrites()).toHaveLength(1);
  });

  it('letting go and re-gripping within the window yields ONE opinion at the final value', async () => {
    mount();
    await drag(700);
    await wait(40);
    fireEvent.pointerDown(slider(), pe('down', { clientX: 700 }));
    fireEvent.pointerMove(slider(), pe('move', { clientX: 900 }));
    fireEvent.pointerUp(slider(), pe('up', { clientX: 900 }));
    await waitFor(() => expect(opinionWrites()).toHaveLength(1));
    await wait(300);
    expect(opinionWrites()).toHaveLength(1);
    expect(opinionWrites()[0].data.offerAmount).toBe(1160000);
  });

  it('is operable from a keyboard / switch control, and still saves just once', async () => {
    mount();
    slider().focus();
    fireEvent.keyDown(slider(), { key: 'ArrowRight' });
    fireEvent.keyDown(slider(), { key: 'ArrowRight' });
    fireEvent.keyUp(slider(), { key: 'ArrowRight' });
    await waitFor(() => expect(opinionWrites()).toHaveLength(1));
    expect(opinionWrites()[0].data.offerAmount).toBe(1020000);
  });

  it('respects the property price boundaries (cannot leave the min–max range)', async () => {
    mount();
    await drag(5000);                        // far past the right edge
    await waitFor(() => expect(opinionWrites()).toHaveLength(1));
    expect(opinionWrites()[0].data.offerAmount).toBe(1200000);
  });
});

describe('honest saving and reliability', () => {
  it('never says "saved" until the server has acknowledged the write', async () => {
    server.hang = true;                       // server never answers
    mount();
    await drag(800);
    const thanks = await screen.findByTestId('kiosk-thanks');
    expect(thanks.textContent).not.toMatch(/\bis saved\b/i);
    await waitFor(() => expect(screen.getByTestId('kiosk-thanks').textContent).toMatch(/stored on this iPad/i));
  });

  it('says saved once the server acknowledges it', async () => {
    mount();
    await drag(800);
    await waitFor(() => expect(screen.getByTestId('kiosk-thanks').textContent).toMatch(/your opinion is saved/i));
  });

  it('offline: stores honestly, shows a quiet "waiting to upload", then uploads when the connection returns — without duplicates', async () => {
    server.online = false;
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: false });
    mount();
    await drag(800);
    expect((await screen.findByTestId('kiosk-thanks')).textContent).toMatch(/stored on this iPad/i);
    await waitFor(() => expect(screen.getByTestId('kiosk-sync').textContent).toMatch(/Offline — 1 waiting/));
    expect(Object.keys(server.docs)).toHaveLength(0);
    expect(JSON.parse(memory.get('pm_kiosk_outbox_v1'))).toHaveLength(1);        // durable on the iPad

    server.online = true;
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
    await act(async () => { window.dispatchEvent(new Event('online')); });
    await waitFor(() => expect(Object.keys(server.docs)).toHaveLength(1));
    expect(new Set(server.writes.map((w) => w.docId)).size).toBe(1);               // same id on every attempt
    await waitFor(() => expect(screen.queryByTestId('kiosk-sync')).toBeNull());
  });

  it('a reload with an opinion still queued delivers it on startup', async () => {
    server.online = false;
    const first = mount();
    await drag(800);
    await waitFor(() => expect(memory.get('pm_kiosk_outbox_v1')).toBeTruthy());
    first.unmount();
    server.online = true;
    mount();                                  // "page reload"
    await waitFor(() => expect(Object.keys(server.docs)).toHaveLength(1));
  });
});

describe('every visitor starts fresh', () => {
  it('the second, third and fourth visitor all submit normally, with no refresh, and nothing carries over', async () => {
    mount();
    const targets = [800, 300, 950, 600];
    for (const t of targets) {
      await drag(t);
      await waitFor(() => expect(screen.getByTestId('kiosk-thanks')).toBeTruthy());
      await waitFor(() => expect(screen.getByText(/what do you think it.s worth/i)).toBeTruthy(), { timeout: 2500 }); // auto-reset
      expect(document.body.textContent).not.toMatch(/\$\d,\d{3},\d{3}/);          // previous price is gone
    }
    expect(opinionWrites()).toHaveLength(4);
    expect(new Set(opinionWrites().map((w) => w.docId)).size).toBe(4);
    expect(new Set(opinionWrites().map((w) => w.data.sessionId)).size).toBe(4);
  });

  it('the next visitor is not blocked while an earlier opinion is still syncing', async () => {
    server.hang = true;
    mount();
    await drag(800);
    await waitFor(() => expect(opinionWrites()).toHaveLength(1));
    await waitFor(() => expect(screen.getByText(/what do you think it.s worth/i)).toBeTruthy(), { timeout: 2500 });
    await drag(400);
    await waitFor(() => expect(opinionWrites().length).toBeGreaterThanOrEqual(2));
    expect(new Set(opinionWrites().map((w) => w.docId)).size).toBe(2);
  });
});

describe('Register interest: same page, private, honest', () => {
  const fill = (v = {}) => {
    const d = { first: 'Jane', last: 'Buyer', email: 'jane@example.com', phone: '0400 111 222', ...v };
    fireEvent.change(screen.getByLabelText('First name'), { target: { value: d.first } });
    fireEvent.change(screen.getByLabelText('Last name'), { target: { value: d.last } });
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: d.email } });
    fireEvent.change(screen.getByLabelText('Mobile'), { target: { value: d.phone } });
  };

  it('is available straight after an opinion; opens a modal on the same page; registration is tied to that opinion', async () => {
    mount();
    await drag(800);
    await waitFor(() => expect(opinionWrites()).toHaveLength(1));
    const opinionId = opinionWrites()[0].docId;
    fireEvent.click(screen.getByRole('button', { name: /register interest/i }));
    expect(await screen.findByRole('dialog')).toBeTruthy();
    expect(screen.getByTestId('open-home-kiosk')).toBeTruthy();       // still the same page
    fill();
    fireEvent.click(screen.getByRole('button', { name: /send my details/i }));
    await waitFor(() => expect(server.writes.some((w) => w.data.serious)).toBe(true));
    const reg = server.writes.find((w) => w.data.serious);
    expect(reg.docId).toBe(opinionId);                               // merged onto the visitor's own opinion
    expect(reg.data).toMatchObject({ serious: true, buyerName: 'Jane Buyer', buyerEmail: 'jane@example.com', buyerPhone: '0400 111 222', offerAmount: 1120000, nextAction: 'contact', fromIpadMode: true });
    expect('userId' in reg.data).toBe(false);
  });

  it('notifies the agent through the existing route only after the registration is acknowledged, and says so honestly', async () => {
    mount();
    fireEvent.click(screen.getByRole('button', { name: /register interest/i }));
    await screen.findByRole('dialog');
    fill();
    fireEvent.click(screen.getByRole('button', { name: /send my details/i }));
    await waitFor(() => expect(server.notified).toHaveLength(1));
    expect(server.notified[0]).toBe(server.writes.find((w) => w.data.serious).docId);
    await waitFor(() => expect(screen.getByTestId('kiosk-reg-done').textContent).toMatch(/details are saved and Phil Chillemi will be in touch/));
  });

  it('works without any slider opinion: a registration-only record with no invented price', async () => {
    mount();
    fireEvent.click(screen.getByRole('button', { name: /register interest/i }));
    await screen.findByRole('dialog');
    fill();
    fireEvent.click(screen.getByRole('button', { name: /send my details/i }));
    await waitFor(() => expect(server.writes).toHaveLength(1));
    expect(server.writes[0].data.serious).toBe(true);
    expect('offerAmount' in server.writes[0].data).toBe(false);
  });

  it('offline: never claims the details were sent', async () => {
    server.online = false;
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: false });
    mount();
    fireEvent.click(screen.getByRole('button', { name: /register interest/i }));
    await screen.findByRole('dialog');
    fill();
    fireEvent.click(screen.getByRole('button', { name: /send my details/i }));
    const done = await screen.findByTestId('kiosk-reg-done');
    expect(done.textContent).toMatch(/stored on this iPad and will be sent/i);
    expect(done.textContent).not.toMatch(/saved and/i);
    expect(server.notified).toHaveLength(0);
  });

  it('requires name, email and phone, and a plausible email', async () => {
    mount();
    fireEvent.click(screen.getByRole('button', { name: /register interest/i }));
    await screen.findByRole('dialog');
    fireEvent.click(screen.getByRole('button', { name: /send my details/i }));
    expect((await screen.findByRole('alert')).textContent).toMatch(/name, email and phone/i);
    fill({ email: 'not-an-email' });
    fireEvent.click(screen.getByRole('button', { name: /send my details/i }));
    expect((await screen.findByRole('alert')).textContent).toMatch(/email address/i);
    expect(server.writes).toHaveLength(0);
  });

  it('a double tap on Send submits once', async () => {
    mount();
    fireEvent.click(screen.getByRole('button', { name: /register interest/i }));
    await screen.findByRole('dialog');
    fill();
    const send = screen.getByRole('button', { name: /send my details/i });
    fireEvent.click(send); fireEvent.click(send);
    await waitFor(() => expect(server.writes.length).toBeGreaterThanOrEqual(1));
    await wait(200);
    expect(server.writes.filter((w) => w.data.serious)).toHaveLength(1);
  });

  it('wipes everything typed after 60s (here: the injected idle time) of inactivity, and the next visitor sees an empty form', async () => {
    mount();
    fireEvent.click(screen.getByRole('button', { name: /register interest/i }));
    await screen.findByRole('dialog');
    fill({ first: 'Secret', email: 'secret@example.com' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull(), { timeout: 2000 });
    expect(document.body.textContent).not.toMatch(/Secret|secret@example\.com/);
    fireEvent.click(screen.getByRole('button', { name: /register interest/i }));
    await screen.findByRole('dialog');
    expect(screen.getByLabelText('First name').value).toBe('');
    expect(screen.getByLabelText('Email').value).toBe('');
    expect(server.writes).toHaveLength(0);                        // abandoned details are never sent
  });

  it('typing keeps the modal alive (the idle timer restarts on activity)', async () => {
    mount();
    fireEvent.click(screen.getByRole('button', { name: /register interest/i }));
    await screen.findByRole('dialog');
    for (let i = 0; i < 4; i += 1) { await wait(250); fireEvent.input(screen.getByLabelText('First name'), { target: { value: `J${i}` } }); }
    expect(screen.getByRole('dialog')).toBeTruthy();
  });

  it('Esc and the close button close it and clear the details', async () => {
    mount();
    fireEvent.click(screen.getByRole('button', { name: /register interest/i }));
    await screen.findByRole('dialog');
    fill();
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    fireEvent.click(screen.getByRole('button', { name: /register interest/i }));
    await screen.findByRole('dialog');
    expect(screen.getByLabelText('First name').value).toBe('');
  });

  it('after one visitor registers, the next sees no previous details or opinion, and their registration is NOT linked to the previous opinion', async () => {
    mount();
    await drag(800);
    await waitFor(() => expect(opinionWrites()).toHaveLength(1));
    const firstOpinion = opinionWrites()[0].docId;
    fireEvent.click(screen.getByRole('button', { name: /register interest/i }));
    await screen.findByRole('dialog');
    fill({ first: 'Alice' });
    fireEvent.click(screen.getByRole('button', { name: /send my details/i }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull(), { timeout: 6000 });
    expect(document.body.textContent).not.toMatch(/Alice|jane@example\.com|1,120,000/);

    fireEvent.click(screen.getByRole('button', { name: /register interest/i }));       // the NEXT visitor
    await screen.findByRole('dialog');
    fill({ first: 'Bob', email: 'bob@example.com' });
    fireEvent.click(screen.getByRole('button', { name: /send my details/i }));
    await waitFor(() => expect(server.writes.filter((w) => w.data.serious)).toHaveLength(2));
    const bob = server.writes.filter((w) => w.data.serious)[1];
    expect(bob.data.buyerName).toBe('Bob Buyer');
    expect(bob.docId).not.toBe(firstOpinion);
    expect('offerAmount' in bob.data).toBe(false);
  });

  it('tapping Register while a release is still settling finalises that opinion first (registration links to it)', async () => {
    mount();
    await drag(800);
    fireEvent.click(screen.getByRole('button', { name: /register interest/i }));
    await screen.findByRole('dialog');
    await waitFor(() => expect(opinionWrites()).toHaveLength(1));
    fill();
    fireEvent.click(screen.getByRole('button', { name: /send my details/i }));
    await waitFor(() => expect(server.writes.some((w) => w.data.serious)).toBe(true));
    expect(server.writes.find((w) => w.data.serious).docId).toBe(opinionWrites()[0].docId);
  });
});

describe('staff exit and demo mode', () => {
  it('a hidden 3-second long-press on the logo exits; a short press does not', async () => {
    const onExit = vi.fn();
    mount({ onExit });
    const logo = screen.getByTestId('kiosk-logo');
    fireEvent.pointerDown(logo, pe('down'));
    await wait(120);
    fireEvent.pointerUp(logo, pe('up'));
    await wait(400);
    expect(onExit).not.toHaveBeenCalled();
    fireEvent.pointerDown(logo, pe('down'));
    await waitFor(() => expect(onExit).toHaveBeenCalledTimes(1), { timeout: 1500 });
  });

  it('there is no visible "Desktop View" button for visitors', () => {
    mount({ onExit: vi.fn() });
    expect(screen.queryByText(/desktop view/i)).toBeNull();
  });

  it('demo mode runs the whole flow but writes nothing, and says so', async () => {
    mount({ demoMode: true });
    expect(screen.getByText(/Demo mode/i)).toBeTruthy();
    await drag(800);
    expect((await screen.findByTestId('kiosk-thanks')).textContent).toMatch(/Demo only — nothing is saved/);
    fireEvent.click(screen.getByRole('button', { name: /register interest/i }));
    await screen.findByRole('dialog');
    fireEvent.change(screen.getByLabelText('First name'), { target: { value: 'Jane' } });
    fireEvent.change(screen.getByLabelText('Last name'), { target: { value: 'Buyer' } });
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'jane@example.com' } });
    fireEvent.change(screen.getByLabelText('Mobile'), { target: { value: '0400 111 222' } });
    fireEvent.click(screen.getByRole('button', { name: /send my details/i }));
    expect((await screen.findByTestId('kiosk-reg-done')).textContent).toMatch(/Demo only — nothing was sent/);
    await wait(400);
    expect(server.writes).toHaveLength(0);
    expect(server.notified).toHaveLength(0);
    expect(memory.size).toBe(0);
  });
});

describe('integration guard rails', () => {
  it('the property page uses the kiosk for ?mode=ipad and the old multi-step iPad code is gone', () => {
    const page = fs.readFileSync('src/app/components/PropertyPageClient.js', 'utf-8');
    expect(page).toContain("import OpenHomeKiosk from './kiosk/OpenHomeKiosk'");
    expect(page).toContain('<OpenHomeKiosk');
    for (const gone of ['saveIpadPriceOpinion', 'resetIpadMode', 'handleIpadContactSubmit', 'Lock in my opinion', 'ipadContactStep', 'Desktop View']) {
      expect(page).not.toContain(gone);
    }
    expect(page).toContain("searchParams.get('demo') === '1'");
  });
  it('the TV display kiosk is untouched', () => {
    const tv = fs.readFileSync('src/app/tv/[id]/page.js', 'utf-8');
    expect(tv).not.toContain('OpenHomeKiosk');
    expect(tv).toContain('PriceOpinionSlider');
  });
  it('the kiosk persistence layer never writes a userId', () => {
    const src = fs.readFileSync('src/app/utils/kioskPersistence.js', 'utf-8');
    expect(src.replace(/\/\*[\s\S]*?\*\//g, '')).not.toMatch(/userId\s*[:=]/);
  });
});
