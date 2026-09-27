import { describe, expect, it } from 'vitest';
import { MAX_ROOM_NAME_LENGTH, generateRoomId, normalizeRoomName, roomKey, roomSearch } from './room';

describe('generateRoomId', () => {
  it('produces a xxx-xxxx-xxx code that is a valid room name', () => {
    for (let i = 0; i < 50; i++) {
      const id = generateRoomId();
      expect(id).toMatch(/^[a-z2-9]{3}-[a-z2-9]{4}-[a-z2-9]{3}$/);
      expect(normalizeRoomName(id)).toBe(id);
    }
  });

  it('never uses ambiguous characters', () => {
    expect(generateRoomId(() => 0.9999)).not.toMatch(/[01ilo]/);
  });
});

describe('normalizeRoomName', () => {
  it('accepts any name or number', () => {
    expect(normalizeRoomName('Design sync')).toBe('Design sync');
    expect(normalizeRoomName('4021')).toBe('4021');
    expect(normalizeRoomName("Kaushik's room")).toBe("Kaushik's room");
    expect(normalizeRoomName('Café ☕ 2')).toBe('Café ☕ 2');
    expect(normalizeRoomName('team:standup')).toBe('team:standup');
  });

  it('collapses whitespace and strips control characters', () => {
    expect(normalizeRoomName('  Weekly \n\t  review  ')).toBe('Weekly review');
    expect(normalizeRoomName('a\u0000b\u200Bc')).toBe('abc');
  });

  it('caps the length without splitting characters', () => {
    const long = '😀'.repeat(MAX_ROOM_NAME_LENGTH + 10);
    expect(Array.from(normalizeRoomName(long)!)).toHaveLength(MAX_ROOM_NAME_LENGTH);
  });

  it('extracts the room from a pasted link', () => {
    expect(normalizeRoomName('https://orbitcall.netlify.app/?room=Design+sync')).toBe('Design sync');
    expect(normalizeRoomName('https://orbitcall.netlify.app/?room=abc-defg-hjk')).toBe('abc-defg-hjk');
  });

  it('rejects empty input and links without a room', () => {
    expect(normalizeRoomName('')).toBeNull();
    expect(normalizeRoomName('   ')).toBeNull();
    expect(normalizeRoomName('https://example.com/?other=1')).toBeNull();
  });
});

describe('roomKey / roomSearch', () => {
  it('matches rooms case-insensitively', () => {
    expect(roomKey('Team Sync')).toBe(roomKey('team sync'));
  });

  it('round-trips names through the query string', () => {
    const name = 'Q3 planning & review #2';
    expect(new URLSearchParams(roomSearch(name)).get('room')).toBe(name);
  });
});
