import { describe, expect, it } from 'vitest';
import { loadConfig } from './config';

describe('loadConfig', () => {
  it('reports missing Supabase settings', () => {
    expect(loadConfig({})).toEqual({ ok: false, missing: ['VITE_SUPABASE_URL', 'VITE_SUPABASE_ANON_KEY'] });
  });

  it('uses public STUN by default', () => {
    const result = loadConfig({ VITE_SUPABASE_URL: 'https://x.supabase.co', VITE_SUPABASE_ANON_KEY: 'key' });
    expect(result.ok && result.config.iceServers).toHaveLength(1);
  });

  it('adds a TURN server when configured', () => {
    const result = loadConfig({
      VITE_SUPABASE_URL: 'https://x.supabase.co',
      VITE_SUPABASE_ANON_KEY: 'key',
      VITE_TURN_URLS: 'turn:t.example.com:3478, turns:t.example.com:5349',
      VITE_TURN_USERNAME: 'u',
      VITE_TURN_CREDENTIAL: 'p',
    });
    expect(result.ok && result.config.iceServers[1]).toEqual({
      urls: ['turn:t.example.com:3478', 'turns:t.example.com:5349'],
      username: 'u',
      credential: 'p',
    });
  });
});
