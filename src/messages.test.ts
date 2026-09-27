import { describe, expect, it } from 'vitest';
import { MAX_CHAT_LENGTH, MAX_NAME_LENGTH, decodeMessage, encodeMessage, type PeerMessage } from './messages';

describe('peer messages', () => {
  it('round-trips chat and state messages', () => {
    const chat: PeerMessage = { type: 'chat', id: '1', text: 'hi there', sentAt: 123 };
    const state: PeerMessage = { type: 'state', name: 'Ada', media: { audio: true, video: false, screen: true } };
    expect(decodeMessage(encodeMessage(chat))).toEqual(chat);
    expect(decodeMessage(encodeMessage(state))).toEqual(state);
  });

  it('rejects non-JSON, non-string and unknown payloads', () => {
    expect(decodeMessage('not json')).toBeNull();
    expect(decodeMessage(new ArrayBuffer(4))).toBeNull();
    expect(decodeMessage('null')).toBeNull();
    expect(decodeMessage(JSON.stringify({ type: 'exec', cmd: 'rm' }))).toBeNull();
  });

  it('rejects malformed fields', () => {
    expect(decodeMessage(JSON.stringify({ type: 'chat', id: 1, text: 'x', sentAt: 1 }))).toBeNull();
    expect(decodeMessage(JSON.stringify({ type: 'chat', id: '1', text: '   ', sentAt: 1 }))).toBeNull();
    expect(decodeMessage(JSON.stringify({ type: 'state', name: 'x', media: { audio: 'yes' } }))).toBeNull();
  });

  it('truncates oversized text and names and strips extra fields', () => {
    const chat = decodeMessage(JSON.stringify({ type: 'chat', id: '1', text: 'a'.repeat(5000), sentAt: 1, evil: true }));
    expect(chat).toEqual({ type: 'chat', id: '1', text: 'a'.repeat(MAX_CHAT_LENGTH), sentAt: 1 });

    const state = decodeMessage(
      JSON.stringify({ type: 'state', name: 'n'.repeat(100), media: { audio: true, video: true, screen: false, x: 1 } }),
    );
    expect(state).toEqual({
      type: 'state',
      name: 'n'.repeat(MAX_NAME_LENGTH),
      media: { audio: true, video: true, screen: false },
    });
  });
});
