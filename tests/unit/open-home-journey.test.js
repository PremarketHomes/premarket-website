// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createElement, forwardRef } from 'react';
import { render, screen, fireEvent, waitFor, cleanup, within } from '@testing-library/react';

// The buyer's phone flow and the agent's view, rendered for real (concept demo, browser-local data):
// check in → checked in → anonymous opinion (or skip) → done, register interest, reopen after closing the page,
// and what the agent's dashboard shows (and never shows) about opinions.

vi.mock('framer-motion', async () => {
  const React = await import('react');
  const strip = ({ initial, animate, exit, transition, layout, whileHover, whileTap, ...rest }) => rest; // eslint-disable-line no-unused-vars
  const cache = {};
  const make = (tag) => (cache[tag] ||= React.forwardRef((p, ref) => React.createElement(tag, { ...strip(p), ref })));
  return { motion: new Proxy({}, { get: (_, tag) => make(tag) }), AnimatePresence: ({ children }) => children, useReducedMotion: () => true };
});
vi.mock('next/link', () => ({ default: forwardRef(({ href, children, ...rest }, ref) => createElement('a', { href, ref, ...rest }, children)) }));

const { demoLatency, readJson } = await import('../../src/app/concepts/open-home/_lib/demoStorage');
const { startSession, endSession } = await import('../../src/app/concepts/open-home/_lib/sessionStore');
const { listAttendance } = await import('../../src/app/concepts/open-home/_lib/attendanceStore');
const { submitOpinion } = await import('../../src/app/concepts/open-home/_lib/opinionStore');
const { DEMO_PROPERTIES, opinionRangeFor } = await import('../../src/app/concepts/open-home/_lib/demoProperties');
const BuyerJourney = (await import('../../src/app/concepts/open-home/_components/BuyerJourney')).default;
const { SessionPanel } = await import('../../src/app/concepts/open-home/_components/AgentDashboard');

const PROPERTY = DEMO_PROPERTIES[0];
const RANGE = opinionRangeFor(PROPERTY);
const stage = (c) => c.querySelector('[data-journey-stage]')?.getAttribute('data-journey-stage');

beforeEach(() => {
  demoLatency.ms = 0;
  window.localStorage.clear();
  window.scrollTo = () => {};
  cleanup();
});

async function checkInAs(container, { name = 'Olivia Bennett', mobile = '0491 570 006', email = 'olivia@example.com' } = {}) {
  fireEvent.change(screen.getByLabelText('Full name'), { target: { value: name } });
  fireEvent.change(screen.getByLabelText('Mobile number'), { target: { value: mobile } });
  fireEvent.change(screen.getByLabelText('Email address'), { target: { value: email } });
  fireEvent.click(screen.getByRole('button', { name: /Check in/ }));
  await waitFor(() => expect(stage(container)).toBe('checked-in'));
}

describe('buyer journey', () => {
  it('validates, checks in, takes an anonymous opinion and finishes on the green screen', async () => {
    const s = startSession(PROPERTY.id);
    const { container } = render(createElement(BuyerJourney, { property: PROPERTY, sessionId: s.id }));
    await waitFor(() => expect(stage(container)).toBe('check-in'));

    // Co-branded with the office's own logo, plus the property and the privacy notice.
    expect(screen.getByAltText('Premarket')).toBeTruthy();
    expect(screen.getByAltText('Harcourts Property Hub').getAttribute('src')).toBe('/offices/hph/logo-colour.png');
    expect(screen.getByText(PROPERTY.street)).toBeTruthy();
    expect(screen.getByText(/never attached to your price opinion/)).toBeTruthy();

    // Empty submit: three clear errors, nothing stored.
    fireEvent.click(screen.getByRole('button', { name: /Check in/ }));
    expect(screen.getByText('Please enter your name.')).toBeTruthy();
    expect(screen.getByText('Please enter your mobile number.')).toBeTruthy();
    expect(screen.getByText('Please enter your email address.')).toBeTruthy();
    expect(screen.getByLabelText('Full name').getAttribute('aria-invalid')).toBe('true');
    expect(listAttendance(s.id)).toEqual([]);

    await checkInAs(container);
    expect(screen.getByText('You’re checked in!')).toBeTruthy();
    expect(screen.getByText('Check-in complete')).toBeTruthy();
    expect(listAttendance(s.id)).toHaveLength(1);

    fireEvent.click(screen.getByRole('button', { name: /Leave my anonymous opinion/ }));
    await waitFor(() => expect(stage(container)).toBe('opinion'));
    const submit = screen.getByRole('button', { name: /Submit anonymous opinion/ });
    expect(submit.disabled).toBe(true); // no figure, no submit, until the buyer actually moves the slider
    expect(screen.getByText('Slide to choose a price')).toBeTruthy();
    const slider = screen.getByLabelText('Price opinion');
    expect([Number(slider.min), Number(slider.max), Number(slider.step)]).toEqual([RANGE.min, RANGE.max, 10000]);
    const amount = RANGE.min + 300000;
    fireEvent.change(slider, { target: { value: String(amount) } });
    expect(screen.getByTestId('opinion-value').textContent).toBe(`$${amount.toLocaleString('en-AU')}`);
    fireEvent.click(screen.getByRole('button', { name: /Submit anonymous opinion/ }));
    await waitFor(() => expect(stage(container)).toBe('complete'));

    expect(screen.getByText('You’re all done!')).toBeTruthy();
    expect(screen.getByText('VISIT COMPLETE')).toBeTruthy();
    // Word for word the screen a buyer who skipped gets (see the next test): nothing on it says an opinion was given.
    expect(screen.getByText('Thanks for visiting today.')).toBeTruthy();
    expect(screen.queryByText(/sharing your anonymous opinion/)).toBeNull();

    // Stored: the amount alone on one side, identity alone on the other, and the phone never keeps the amount.
    expect(readJson(`opinions:${s.id}`, null)).toEqual([amount]);
    expect(JSON.stringify(listAttendance(s.id))).not.toContain(String(amount));
    const visit = readJson(`visit:${s.id}`, null);
    expect(visit).toMatchObject({ stage: 'complete', outcome: 'opinion' });
    expect(JSON.stringify(visit)).not.toContain(String(amount));
  });

  it('skipping the opinion is respected: same green finish, no "thanks for your opinion", nothing recorded', async () => {
    const s = startSession(PROPERTY.id);
    const { container } = render(createElement(BuyerJourney, { property: PROPERTY, sessionId: s.id }));
    await waitFor(() => expect(stage(container)).toBe('check-in'));
    await checkInAs(container);
    fireEvent.click(screen.getByRole('button', { name: /Leave my anonymous opinion/ }));
    fireEvent.click(screen.getByRole('button', { name: /prefer not to give an opinion/ }));
    await waitFor(() => expect(stage(container)).toBe('complete'));
    expect(screen.getByText('You’re all done!')).toBeTruthy();
    expect(screen.getByText('VISIT COMPLETE')).toBeTruthy();
    expect(screen.getByText('Thanks for visiting today.')).toBeTruthy();
    expect(screen.queryByText(/sharing your anonymous opinion/)).toBeNull();
    expect(readJson(`opinions:${s.id}`, [])).toEqual([]);
  });

  it('the green screen is identical, character for character, after submitting or skipping', async () => {
    const finish = async (submit) => {
      cleanup();
      window.localStorage.clear();
      const s = startSession(PROPERTY.id);
      const { container } = render(createElement(BuyerJourney, { property: PROPERTY, sessionId: s.id }));
      await waitFor(() => expect(stage(container)).toBe('check-in'));
      await checkInAs(container);
      fireEvent.click(screen.getByRole('button', { name: /Leave my anonymous opinion/ }));
      if (submit) {
        fireEvent.change(screen.getByLabelText('Price opinion'), { target: { value: String(RANGE.min + 100000) } });
        fireEvent.click(screen.getByRole('button', { name: /Submit anonymous opinion/ }));
      } else {
        fireEvent.click(screen.getByRole('button', { name: /prefer not to give an opinion/ }));
      }
      await waitFor(() => expect(stage(container)).toBe('complete'));
      return container.querySelector('[data-stage="complete"]').outerHTML;
    };
    expect(await finish(true)).toBe(await finish(false));
  });

  it('the live pilot’s opinion screen says the agent sees the amounts after the end and may be able to guess; the demo keeps its wording', async () => {
    for (const [opinionNotice, expected] of [['after-end', /sees each amount given, lowest to highest, but never who gave which\. If only a few people visit, they may be able to guess\./], [undefined, /only ever sees combined results, after the open home/]]) {
      cleanup();
      window.localStorage.clear();
      const s = startSession(PROPERTY.id);
      const { container } = render(createElement(BuyerJourney, { property: PROPERTY, sessionId: s.id, opinionNotice }));
      await waitFor(() => expect(stage(container)).toBe('check-in'));
      await checkInAs(container);
      fireEvent.click(screen.getByRole('button', { name: /Leave my anonymous opinion/ }));
      await waitFor(() => expect(stage(container)).toBe('opinion'));
      expect(screen.getByTestId('opinion-notice').textContent.replace(/\s+/g, ' ')).toMatch(expected);
    }
  });

  it('register interest from the green screen goes to the identity record only, with no retyping', async () => {
    const s = startSession(PROPERTY.id);
    const { container } = render(createElement(BuyerJourney, { property: PROPERTY, sessionId: s.id }));
    await waitFor(() => expect(stage(container)).toBe('check-in'));
    await checkInAs(container);
    fireEvent.click(screen.getByRole('button', { name: /Leave my anonymous opinion/ }));
    fireEvent.change(screen.getByLabelText('Price opinion'), { target: { value: String(RANGE.min) } });
    fireEvent.click(screen.getByRole('button', { name: /Submit anonymous opinion/ }));
    await waitFor(() => expect(stage(container)).toBe('complete'));
    fireEvent.click(screen.getByRole('button', { name: 'Register my interest' }));
    expect(screen.getByText(/Any price opinion stays anonymous and is never included/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Send the contract' }));
    fireEvent.click(screen.getByRole('button', { name: /Send to Alex/ }));
    await waitFor(() => expect(screen.getByTestId('interest-done')).toBeTruthy());
    const [rec] = listAttendance(s.id);
    expect(rec.interest).toEqual({ wants: ['contract'] });
    expect(Object.keys(rec)).not.toContain('offerAmount');
    expect(readJson(`opinions:${s.id}`, [])).toEqual([RANGE.min]);
  });

  it('closing and reopening the page picks up where the buyer was', async () => {
    const s = startSession(PROPERTY.id);
    const first = render(createElement(BuyerJourney, { property: PROPERTY, sessionId: s.id }));
    await waitFor(() => expect(stage(first.container)).toBe('check-in'));
    await checkInAs(first.container);
    first.unmount();
    const again = render(createElement(BuyerJourney, { property: PROPERTY, sessionId: s.id }));
    await waitFor(() => expect(stage(again.container)).toBe('checked-in'));
    expect(screen.getByText(/Olivia, checked in/)).toBeTruthy();
    expect(listAttendance(s.id)).toHaveLength(1); // not checked in twice
  });

  it('a phone that arrives after the open home has ended is told so, without a form', async () => {
    const s = startSession(PROPERTY.id);
    endSession(s.id);
    const { container } = render(createElement(BuyerJourney, { property: PROPERTY, sessionId: s.id }));
    await waitFor(() => expect(stage(container)).toBe('ended'));
    expect(screen.getByText('This open home has finished.')).toBeTruthy();
    expect(screen.queryByLabelText('Full name')).toBeNull();
  });
});

describe("agent's dashboard", () => {
  it('live: attendance by name, opinions only as a stepped count, no amounts anywhere', async () => {
    const s = startSession(PROPERTY.id);
    const amounts = [RANGE.min + 100000, RANGE.min + 210000, RANGE.min + 320000];
    for (const a of amounts) await submitOpinion(s.id, a, RANGE);
    render(createElement(SessionPanel, { sessionId: s.id }));
    // check in after render: the live view picks it up
    const { checkIn } = await import('../../src/app/concepts/open-home/_lib/attendanceStore');
    await checkIn(s.id, { fullName: 'Liam Nguyen', mobile: '0491 570 156', email: 'liam@example.com' });
    await waitFor(() => expect(screen.getByTestId('kpi-checked-in').textContent).toBe('1'));
    expect(screen.getByTestId('kpi-opinions').textContent).toBe('Fewer than 5');
    const list = screen.getByTestId('attendance-list');
    expect(within(list).getByText('Liam Nguyen')).toBeTruthy();
    expect(within(list).getByText('0491 570 156')).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/\$\s?\d/); // no price on screen while live
    expect(screen.getByTestId('session-live')).toBeTruthy();
  });

  it('after ending: combined results from 5+, and the register still carries no price', async () => {
    const s = startSession(PROPERTY.id);
    const { checkIn } = await import('../../src/app/concepts/open-home/_lib/attendanceStore');
    for (let i = 0; i < 6; i += 1) {
      await checkIn(s.id, { fullName: `Buyer Number${'abcdef'[i]}`, mobile: `0491 570 15${i}`, email: `b${i}@example.com` });
      await submitOpinion(s.id, RANGE.min + i * 50000, RANGE);
    }
    render(createElement(SessionPanel, { sessionId: s.id }));
    fireEvent.click(screen.getByTestId('end-session'));
    fireEvent.click(screen.getByTestId('confirm-end'));
    await waitFor(() => expect(screen.getByTestId('session-summary')).toBeTruthy());
    expect(screen.getByTestId('summary-attended').textContent).toBe('6');
    expect(screen.getByTestId('summary-opinions').textContent).toBe('6');
    expect(screen.getByTestId('opinion-results').textContent).toMatch(/Typical buyer opinion/);
    expect(screen.getByTestId('attendance-list').textContent).not.toMatch(/\$/);
  });

  it('after ending with fewer than 5 opinions: nothing about price is shown', async () => {
    const s = startSession(PROPERTY.id);
    await submitOpinion(s.id, RANGE.min, RANGE);
    await submitOpinion(s.id, RANGE.max, RANGE);
    endSession(s.id);
    render(createElement(SessionPanel, { sessionId: s.id }));
    expect(screen.getByText('Not enough opinions to show')).toBeTruthy();
    expect(screen.getByTestId('summary-opinions').textContent).toBe('Fewer than 5');
    expect(document.body.textContent).not.toMatch(/\$\s?\d/);
  });
});
