/** Messages exchanged peer-to-peer over the RTCDataChannel once connected. */

export interface MediaState {
  audio: boolean;
  video: boolean;
  screen: boolean;
}

export type PeerMessage =
  | { type: 'chat'; id: string; text: string; sentAt: number }
  | { type: 'state'; name: string; media: MediaState };

export const MAX_CHAT_LENGTH = 2000;
export const MAX_NAME_LENGTH = 40;

export function encodeMessage(message: PeerMessage): string {
  return JSON.stringify(message);
}

function isMediaState(value: unknown): value is MediaState {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return typeof v.audio === 'boolean' && typeof v.video === 'boolean' && typeof v.screen === 'boolean';
}

/** Parses untrusted input from the remote peer; returns null for anything malformed. */
export function decodeMessage(raw: unknown): PeerMessage | null {
  if (typeof raw !== 'string') return null;
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof data !== 'object' || data === null) return null;
  const m = data as Record<string, unknown>;

  if (m.type === 'chat') {
    if (typeof m.id !== 'string' || typeof m.text !== 'string' || typeof m.sentAt !== 'number') return null;
    const text = m.text.slice(0, MAX_CHAT_LENGTH);
    if (!text.trim()) return null;
    return { type: 'chat', id: m.id, text, sentAt: m.sentAt };
  }

  if (m.type === 'state') {
    if (typeof m.name !== 'string' || !isMediaState(m.media)) return null;
    return {
      type: 'state',
      name: m.name.slice(0, MAX_NAME_LENGTH),
      media: { audio: m.media.audio, video: m.media.video, screen: m.media.screen },
    };
  }

  return null;
}
