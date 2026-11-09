import { describe, it, expect } from 'vitest';
import fs from 'node:fs';

// Source-level checks for the HPH launch simplification: no AI listing generator, no Client
// Information step, no AI photo-edit button — while existing client data is never erased.
const read = (rel) => fs.readFileSync(new URL(`../../src/app/${rel}`, import.meta.url), 'utf-8');
const add = read('dashboard/add/page.js');
const edit = read('dashboard/edit/[id]/page.js');
const property = read('dashboard/property/[id]/page.js');
const manual = read('dashboard/user-manual/page.js');

const stepsOf = (src) => {
  const body = src.match(/const STEPS = \{([\s\S]*?)\};/)[1];
  return [...body.matchAll(/(\w+):\s*(\d+)/g)].map((m) => [m[1], Number(m[2])]);
};

describe('Add Property', () => {
  it('has 7 contiguous steps ending at TERMS, with no client or eagerness step', () => {
    const steps = stepsOf(add);
    expect(steps.map(([, n]) => n)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(steps.map(([k]) => k)).not.toContain('EAGERNESS');
    expect(steps.at(-1)[0]).toBe('TERMS');
    expect(steps.map(([k]) => k)).not.toContain('CLIENT_INFO');
  });
  it('no longer asks for or validates client details, nor offers AI generation', () => {
    expect(add).not.toMatch(/CLIENT_INFO|Client Information|client information fields/);
    expect(add).not.toMatch(/handleGenerateAI|Generate with AI|generate-listing/);
  });
  it('still requires a title, keeps the description optional, and saves null client fields', () => {
    expect(add).toContain("step === STEPS.TITLE && !title.trim()");
    expect(add).toContain('Description (Optional)');
    expect(add).toMatch(/clientName: null,\s*clientEmail: null,\s*clientPhone: null,/);
  });
  it('still records the charge through the unchanged record-charge call', () => {
    expect(add).toContain('/record-charge');
  });
});

describe('Edit Property', () => {
  it('has no client step or AI generation, and Save Changes is on the final (TITLE) step', () => {
    expect(stepsOf(edit).at(-1)[0]).toBe('TITLE');
    expect(stepsOf(edit)).toHaveLength(6);
    expect(edit).not.toMatch(/CLIENT_INFO|Client Information|client information fields/);
    expect(edit).not.toMatch(/handleGenerateAI|Generate with AI|generate-listing/);
    expect(edit).toContain('step < STEPS.TITLE ?');
    expect(edit).toContain('Save Changes');
  });
  it('loads existing client data into state and writes it back, so it is preserved', () => {
    expect(edit).toContain("setClientName(p.clientName || '')");
    expect(edit).toContain("setClientEmail(p.clientEmail || '')");
    expect(edit).toContain("setClientPhone(p.clientPhone || '')");
    expect(edit).toContain("clientName: clientName.trim() || null");
    expect(edit).toContain("clientEmail: clientEmail.trim() || null");
    expect(edit).toContain("clientPhone: clientPhone.trim() || null");
  });
  it('never blocks saving on empty client details', () => {
    const validate = edit.slice(edit.indexOf('const validateStep'), edit.indexOf('const onNext'));
    expect(validate).not.toMatch(/client/i);
  });
});

describe('Property dashboard and manual', () => {
  it('MediaGallery gets no onEditImage, so the AI Edit button is not rendered', () => {
    const usage = property.slice(property.indexOf('<MediaGallery'), property.indexOf('/>', property.indexOf('<MediaGallery')));
    expect(usage).not.toContain('onEditImage');
    expect(usage).toContain('videoUrl={property.aiVideo?.url || property.videoUrl}'); // AI video untouched
  });
  it('user manual no longer mentions generating listings with AI', () => {
    expect(manual).not.toMatch(/Generate with AI/);
  });
});
