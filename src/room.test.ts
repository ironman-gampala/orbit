import { describe, expect, it } from 'vitest';
import { generateRoomId, normalizeRoomId } from './room';

describe('generateRoomId', () => {
  it('produces a xxx-xxxx-xxx code that normalizes to itself', () => {
    for (let i = 0; i < 50; i++) {
      const id = generateRoomId();
      expect(id).toMatch(/^[a-z2-9]{3}-[a-z2-9]{4}-[a-z2-9]{3}$/);
      expect(normalizeRoomId(id)).toBe(id);
    }
  });

  it('never uses ambiguous characters', () => {
    const id = generateRoomId(() => 0.9999);
    expect(id).not.toMatch(/[01ilo]/);
  });
});

describe('normalizeRoomId', () => {
  it('accepts bare codes with casing and whitespace noise', () => {
    expect(normalizeRoomId('  ABC-DEFG-HJK ')).toBe('abc-defg-hjk');
  });

  it('extracts the code from a full link', () => {
    expect(normalizeRoomId('https://example.com/?room=abc-defg-hjk')).toBe('abc-defg-hjk');
  });

  it('rejects malformed input', () => {
    expect(normalizeRoomId('')).toBeNull();
    expect(normalizeRoomId('hello')).toBeNull();
    expect(normalizeRoomId('abc-defg')).toBeNull();
    expect(normalizeRoomId('https://example.com/?other=1')).toBeNull();
    expect(normalizeRoomId('abc-defg-hjk; drop')).toBeNull();
  });
});
