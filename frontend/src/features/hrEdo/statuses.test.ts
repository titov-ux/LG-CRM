import { describe, expect, it } from 'vitest';
import { docLabel, formatPhone, groupFingerprint, pluralRu } from './statuses';

describe('hrEdo/statuses', () => {
  it('formats E.164 phone', () => {
    expect(formatPhone('+79991234567')).toBe('+7 999 123-45-67');
    expect(formatPhone(null)).toBe('—');
    expect(formatPhone('+441234567890')).toBe('+441234567890');
  });

  it('groups key fingerprint by 4', () => {
    expect(groupFingerprint('0d7a09657a13')).toBe('0d7a 0965 7a13');
  });

  it('builds document label with number', () => {
    expect(docLabel({ title: 'Трудовой договор', number: 'ТД-2026-0001' })).toBe('Трудовой договор № ТД-2026-0001');
    expect(docLabel({ title: 'Черновик', number: null })).toBe('Черновик');
  });

  it('pluralizes russian nouns', () => {
    const forms: [string, string, string] = ['документ', 'документа', 'документов'];
    expect(pluralRu(1, forms)).toBe('документ');
    expect(pluralRu(3, forms)).toBe('документа');
    expect(pluralRu(11, forms)).toBe('документов');
    expect(pluralRu(21, forms)).toBe('документ');
  });
});
