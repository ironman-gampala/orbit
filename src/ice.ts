const ENDPOINT = '/api/ice-servers';

function isIceServer(value: unknown): value is RTCIceServer {
  if (typeof value !== 'object' || value === null) return false;
  const urls = (value as RTCIceServer).urls;
  return typeof urls === 'string' || (Array.isArray(urls) && urls.every((u) => typeof u === 'string'));
}

/**
 * Fetches short-lived TURN credentials from the Netlify function. Falls back to
 * the statically configured servers (public STUN + optional env TURN) if the
 * endpoint is missing (e.g. plain `vite` dev), unconfigured or slow.
 */
export async function fetchIceServers(fallback: RTCIceServer[], timeoutMs = 4000): Promise<RTCIceServer[]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(ENDPOINT, { signal: controller.signal, cache: 'no-store' });
    if (!res.ok) return fallback;
    const data: unknown = await res.json();
    const servers = (data as { iceServers?: unknown })?.iceServers;
    if (!Array.isArray(servers) || !servers.length || !servers.every(isIceServer)) return fallback;
    return [...servers, ...fallback];
  } catch {
    return fallback;
  } finally {
    clearTimeout(timer);
  }
}
