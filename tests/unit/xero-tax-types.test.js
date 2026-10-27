import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import { ZERO_GST_TAX_TYPE, GST_TAX_TYPE, taxTypeForGstAmount } from '../../src/app/api/services/xeroTaxTypes';

describe('shared Xero tax-type constants', () => {
  it('zero-GST is BAS Excluded and GST is OUTPUT', () => {
    expect(ZERO_GST_TAX_TYPE).toBe('BASEXCLUDED');
    expect(GST_TAX_TYPE).toBe('OUTPUT');
  });

  it('REGRESSION: HPH\'s $200 campaign fee (GST $0) maps to BASEXCLUDED — never the placeholder NONE', () => {
    expect(taxTypeForGstAmount(0)).toBe('BASEXCLUDED');
    expect(taxTypeForGstAmount(0)).not.toBe('NONE');
  });

  it.each([[undefined], [null], [''], ['0'], [-5], [NaN]])('anything that is not a positive GST amount is zero-GST (%j)', (v) => {
    expect(taxTypeForGstAmount(v)).toBe('BASEXCLUDED');
  });

  it.each([[20], [0.01], ['20'], [18.18]])('a positive GST amount keeps GST handling: OUTPUT (%j)', (v) => {
    expect(taxTypeForGstAmount(v)).toBe('OUTPUT');
  });
});

describe('the invoice-sending code never uses the placeholder "NONE" tax type', () => {
  const strip = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  const read = (p) => strip(fs.readFileSync(p, 'utf-8'));

  it('the send route takes the tax type from the shared function', () => {
    const src = read('src/app/api/admin/invoicing/runs/[runId]/send/route.js');
    expect(src).toContain('taxTypeForGstAmount(prop.gstAmount)');
    expect(src).not.toMatch(/['"]NONE['"]/);
    expect(src).not.toMatch(/['"]OUTPUT['"]/);            // the literal lives in ONE place only
  });

  it('createInvoice\'s fallback default is the shared constant', () => {
    const src = read('src/app/api/services/xeroService.js');
    const body = src.slice(src.indexOf('export async function createInvoice'), src.indexOf('export async function sendInvoice'));
    expect(body).toContain('taxType || ZERO_GST_TAX_TYPE');
    expect(body).not.toMatch(/['"]NONE['"]/);
  });

  it('no source file anywhere sends a "NONE" tax type to Xero', () => {
    const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(`${dir}/${e.name}`) : [`${dir}/${e.name}`]));
    const offenders = walk('src/app/api').filter((f) => f.endsWith('.js'))
      .filter((f) => /taxType\s*[:=]\s*['"]NONE['"]|TaxType\s*[:=]\s*['"]NONE['"]/.test(read(f)));
    expect(offenders).toEqual([]);
  });

  it('the readiness check and the invoice code agree because both import the same constant', () => {
    const readiness = fs.readFileSync('src/app/api/services/xeroReadinessCheck.js', 'utf-8');
    const svc = fs.readFileSync('src/app/api/services/xeroService.js', 'utf-8');
    expect(readiness).toContain("from './xeroTaxTypes'");
    expect(svc).toContain("from './xeroTaxTypes'");
  });
});
