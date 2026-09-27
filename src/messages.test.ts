import { describe, expect, it } from 'vitest';
import { MAX_CAPTION_LENGTH, MAX_CHAT_LENGTH, MAX_NAME_LENGTH, decodeMessage, encodeMessage, type PeerMessage } from './messages';

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

  it('round-trips caption and transcription messages', () => {
    const caption: PeerMessage = { type: 'caption', id: 'abc:1-0', text: 'hello everyone', final: true, at: 10 };
    const switchOn: PeerMessage = { type: 'transcription', on: true, at: 20, by: 'Asha' };
    expect(decodeMessage(encodeMessage(caption))).toEqual(caption);
    expect(decodeMessage(encodeMessage(switchOn))).toEqual(switchOn);
  });

  it('validates captions and the transcription switch', () => {
    expect(decodeMessage(JSON.stringify({ type: 'caption', id: 'x', text: '  ', final: true, at: 1 }))).toBeNull();
    expect(decodeMessage(JSON.stringify({ type: 'caption', id: 'x', text: 'hi', final: 'yes', at: 1 }))).toBeNull();
    expect(decodeMessage(JSON.stringify({ type: 'caption', id: 'x'.repeat(500), text: 'hi', final: true, at: 1 }))).toBeNull();
    expect(decodeMessage(JSON.stringify({ type: 'transcription', on: true, at: -5, by: 'x' }))).toBeNull();
    const long = decodeMessage(JSON.stringify({ type: 'caption', id: 'x', text: 'w'.repeat(5000), final: false, at: 1 }));
    expect(long?.type === 'caption' && long.text.length).toBe(MAX_CAPTION_LENGTH);
  });
});
