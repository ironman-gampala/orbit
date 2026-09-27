// No 0/o/1/l/i so generated codes survive being read aloud or retyped.
const ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';

export const MAX_ROOM_NAME_LENGTH = 60;

function randomChars(count: number, random: () => number): string {
  let out = '';
  for (let i = 0; i < count; i++) out += ALPHABET[Math.floor(random() * ALPHABET.length)];
  return out;
}

/** Meet-style code, e.g. `abc-defg-hjk`, used when the user doesn't pick a name. */
export function generateRoomId(random: () => number = Math.random): string {
  return [randomChars(3, random), randomChars(4, random), randomChars(3, random)].join('-');
}

/**
 * Any name or number works as a room: "Design sync", "4021", "Kaushik's room".
 * Pasted Orbit links resolve to their room. Whitespace is collapsed, invisible
 * control characters are dropped and the length is capped.
 */
export function normalizeRoomName(input: string): string | null {
  let value = input.trim();
  if (/^https?:\/\//i.test(value)) {
    try {
      const room = new URL(value).searchParams.get('room');
      if (room === null) return null;
      value = room;
    } catch {
      return null;
    }
  }
  value = value.replace(/[\p{Cc}\p{Cf}]/gu, '').replace(/\s+/g, ' ').trim();
  if (!value) return null;
  return Array.from(value).slice(0, MAX_ROOM_NAME_LENGTH).join('').trim();
}

/** Rooms match case-insensitively, so "Team Sync" and "team sync" meet in the same place. */
export function roomKey(name: string): string {
  return name.normalize('NFC').toLowerCase();
}

export function roomSearch(name: string): string {
  return `?${new URLSearchParams({ room: name })}`;
}

export function roomFromLocation(location: Location = window.location): string | null {
  const room = new URLSearchParams(location.search).get('room');
  return room ? normalizeRoomName(room) : null;
}

export function roomUrl(name: string, location: Location = window.location): string {
  const url = new URL(location.href);
  url.search = roomSearch(name);
  url.hash = '';
  return url.toString();
}

export function randomId(): string {
  return crypto.randomUUID();
}
