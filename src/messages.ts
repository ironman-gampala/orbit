/** Messages exchanged peer-to-peer over the RTCDataChannel once connected. */

export interface MediaState {
  audio: boolean;
  video: boolean;
  screen: boolean;
}

export type PeerMessage =
  | { type: 'chat'; id: string; text: string; sentAt: number }
  | { type: 'state'; name: string; media: MediaState }
  /** Live caption of the sender's own voice; interim text is replaced by the final one with the same id. */
  | { type: 'caption'; id: string; text: string; final: boolean; at: number }
  /** Room-wide captions switch. The newest `at` wins so peers converge without a coordinator. */
  | { type: 'transcription'; on: boolean; at: number; by: string };

export const MAX_CHAT_LENGTH = 2000;
export const MAX_NAME_LENGTH = 40;
export const MAX_CAPTION_LENGTH = 1000;
const MAX_ID_LENGTH = 100;

export function encodeMessage(message: PeerMessage): string {
  return JSON.stringify(message);
}

function isMediaState(value: unknown): value is MediaState {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return typeof v.audio === 'boolean' && typeof v.video === 'boolean' && typeof v.screen === 'boolean';
}

function isTime(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
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

  if (m.type === 'caption') {
    if (typeof m.id !== 'string' || typeof m.text !== 'string' || typeof m.final !== 'boolean' || !isTime(m.at)) return null;
    const text = m.text.slice(0, MAX_CAPTION_LENGTH).trim();
    if (!text || !m.id || m.id.length > MAX_ID_LENGTH) return null;
    return { type: 'caption', id: m.id, text, final: m.final, at: m.at };
  }

  if (m.type === 'transcription') {
    if (typeof m.on !== 'boolean' || !isTime(m.at) || typeof m.by !== 'string') return null;
    return { type: 'transcription', on: m.on, at: m.at, by: m.by.slice(0, MAX_NAME_LENGTH) };
  }

  return null;
}
