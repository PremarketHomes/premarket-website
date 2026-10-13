import { describe, it, expect } from 'vitest';
import { parseFields } from '../../src/app/utils/firestoreRest';

describe('parseFields', () => {
  it('parses every Firestore REST scalar type into a plain value', () => {
    const result = parseFields({
      title: { stringValue: 'Rare Family Home' },
      bedrooms: { integerValue: '4' },
      price: { doubleValue: 1250000.5 },
      showSuburbOnly: { booleanValue: true },
      agentId: { nullValue: null },
      createdAt: { timestampValue: '2026-01-01T00:00:00Z' },
    });

    expect(result).toEqual({
      title: 'Rare Family Home',
      bedrooms: 4,
      price: 1250000.5,
      showSuburbOnly: true,
      agentId: null,
      createdAt: '2026-01-01T00:00:00Z',
    });
  });

  it('reconstructs a nested mapValue as a plain nested object', () => {
    const result = parseFields({
      location: {
        mapValue: {
          fields: {
            suburb: { stringValue: 'Bronte' },
            latitude: { doubleValue: -33.9 },
          },
        },
      },
    });

    expect(result.location).toEqual({ suburb: 'Bronte', latitude: -33.9 });
  });

  it('reconstructs an arrayValue of strings as a plain array', () => {
    const result = parseFields({
      imageUrls: {
        arrayValue: {
          values: [{ stringValue: 'https://a.jpg' }, { stringValue: 'https://b.jpg' }],
        },
      },
    });

    expect(result.imageUrls).toEqual(['https://a.jpg', 'https://b.jpg']);
  });

  it('treats a Firestore-omitted empty array as an empty array, not undefined', () => {
    const result = parseFields({ imageUrls: { arrayValue: {} } });
    expect(result.imageUrls).toEqual([]);
  });

  it('returns an empty object for missing/undefined fields', () => {
    expect(parseFields(undefined)).toEqual({});
    expect(parseFields(null)).toEqual({});
  });

  it('handles a deeply nested real-world shape (propertyJob.price_estimate)', () => {
    const result = parseFields({
      propertyJob: {
        mapValue: {
          fields: {
            price_estimate: {
              mapValue: {
                fields: { mid: { integerValue: '950000' } },
              },
            },
          },
        },
      },
    });
    expect(result.propertyJob.price_estimate.mid).toBe(950000);
  });
});
