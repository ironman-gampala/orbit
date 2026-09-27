import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchIceServers } from './ice';

const fallback: RTCIceServer[] = [{ urls: 'stun:stun.l.google.com:19302' }];
const turn: RTCIceServer = { urls: ['turn:turn.cloudflare.com:3478'], username: 'u', credential: 'c' };

const mockFetch = (impl: () => Promise<Partial<Response>>) => vi.stubGlobal('fetch', vi.fn(impl));

afterEach(() => vi.unstubAllGlobals());

describe('fetchIceServers', () => {
  it('prepends servers returned by the endpoint', async () => {
    mockFetch(async () => ({ ok: true, json: async () => ({ iceServers: [turn] }) }));
    expect(await fetchIceServers(fallback)).toEqual([turn, ...fallback]);
  });

  it('falls back when the endpoint errors or is unconfigured', async () => {
    mockFetch(async () => ({ ok: false, json: async () => ({ error: 'TURN is not configured' }) }));
    expect(await fetchIceServers(fallback)).toBe(fallback);
  });

  it('falls back on network failure or malformed data', async () => {
    mockFetch(async () => Promise.reject(new TypeError('offline')));
    expect(await fetchIceServers(fallback)).toBe(fallback);

    mockFetch(async () => ({ ok: true, json: async () => ({ iceServers: [{ nope: 1 }] }) }));
    expect(await fetchIceServers(fallback)).toBe(fallback);
  });

  it('falls back when the endpoint is too slow', async () => {
    vi.stubGlobal('fetch', vi.fn((_url: string, init: RequestInit) =>
      new Promise((_resolve, reject) => init.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))),
    ));
    expect(await fetchIceServers(fallback, 20)).toBe(fallback);
  });
});
