// No 0/o/1/l/i so codes survive being read aloud or retyped.
const ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';
const ROOM_ID_PATTERN = /^[a-z0-9]{3,4}(-[a-z0-9]{3,4}){2}$/;

function randomChars(count: number, random: () => number): string {
  let out = '';
  for (let i = 0; i < count; i++) out += ALPHABET[Math.floor(random() * ALPHABET.length)];
  return out;
}

/** Meet-style code, e.g. `abc-defg-hjk`. */
export function generateRoomId(random: () => number = Math.random): string {
  return [randomChars(3, random), randomChars(4, random), randomChars(3, random)].join('-');
}

export function normalizeRoomId(input: string): string | null {
  let value = input.trim();
  try {
    const url = new URL(value);
    value = url.searchParams.get('room') ?? '';
  } catch {
    // Not a URL; treat as a bare code.
  }
  value = value.toLowerCase().replace(/\s+/g, '');
  return ROOM_ID_PATTERN.test(value) ? value : null;
}

export function roomIdFromLocation(location: Location = window.location): string | null {
  const room = new URLSearchParams(location.search).get('room');
  return room ? normalizeRoomId(room) : null;
}

export function roomUrl(roomId: string, location: Location = window.location): string {
  const url = new URL(location.href);
  url.search = '';
  url.hash = '';
  url.searchParams.set('room', roomId);
  return url.toString();
}

export function randomId(): string {
  return crypto.randomUUID();
}
