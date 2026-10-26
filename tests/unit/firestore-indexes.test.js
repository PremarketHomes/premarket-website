import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

// The invoicing admin screens run these compound queries; Firestore
// refuses them (500) unless a matching composite index exists.
const indexes = JSON.parse(readFileSync('firestore.indexes.json', 'utf8')).indexes;

const find = (collectionGroup, fields) =>
  indexes.find(
    (i) =>
      i.collectionGroup === collectionGroup &&
      JSON.stringify(i.fields.map((f) => [f.fieldPath, f.order])) === JSON.stringify(fields),
  );

describe('firestore.indexes.json', () => {
  it('covers the admin Charges list (propertyCharges: status ==, createdAt desc)', () => {
    expect(find('propertyCharges', [['status', 'ASCENDING'], ['createdAt', 'DESCENDING']])).toBeTruthy();
  });
  it('covers the admin Analytics query (invoiceRuns: status in, periodStart desc)', () => {
    expect(find('invoiceRuns', [['status', 'ASCENDING'], ['periodStart', 'DESCENDING']])).toBeTruthy();
  });
  it('keeps the office invites index', () => {
    expect(find('officeInvites', [['officeId', 'ASCENDING'], ['status', 'ASCENDING']])).toBeTruthy();
  });
  it('covers the daily property-followup job (properties: active, archived, createdAt ascending)', () => {
    expect(find('properties', [['active', 'ASCENDING'], ['archived', 'ASCENDING'], ['createdAt', 'ASCENDING']])).toBeTruthy();
  });
});
