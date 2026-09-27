export interface AppConfig {
  supabaseUrl: string;
  supabaseAnonKey: string;
  iceServers: RTCIceServer[];
}

export type ConfigResult = { ok: true; config: AppConfig } | { ok: false; missing: string[] };

const DEFAULT_STUN: RTCIceServer = {
  urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'],
};

export function loadConfig(env: Record<string, string | undefined> = import.meta.env): ConfigResult {
  const supabaseUrl = env.VITE_SUPABASE_URL?.trim() ?? '';
  const supabaseAnonKey = env.VITE_SUPABASE_ANON_KEY?.trim() ?? '';

  const missing: string[] = [];
  if (!supabaseUrl) missing.push('VITE_SUPABASE_URL');
  if (!supabaseAnonKey) missing.push('VITE_SUPABASE_ANON_KEY');
  if (missing.length) return { ok: false, missing };

  const iceServers: RTCIceServer[] = [DEFAULT_STUN];
  const turnUrls = (env.VITE_TURN_URLS ?? '')
    .split(',')
    .map((u) => u.trim())
    .filter(Boolean);
  if (turnUrls.length) {
    iceServers.push({
      urls: turnUrls,
      username: env.VITE_TURN_USERNAME?.trim() || undefined,
      credential: env.VITE_TURN_CREDENTIAL?.trim() || undefined,
    });
  }

  return { ok: true, config: { supabaseUrl, supabaseAnonKey, iceServers } };
}
