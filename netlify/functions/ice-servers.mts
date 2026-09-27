// Exchanges the long-lived Cloudflare TURN key (server-side secret) for
// short-lived TURN credentials the browser can use.

const TTL_SECONDS = 6 * 60 * 60;
const ALLOWED_ORIGIN = /^https:\/\/([a-z0-9-]+--)?orbitcall\.netlify\.app$|^http:\/\/localhost(:\d+)?$/;

interface IceServer {
  urls: string | string[];
  username?: string;
  credential?: string;
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });

export default async (req: Request): Promise<Response> => {
  const origin = req.headers.get('origin');
  if (origin && !ALLOWED_ORIGIN.test(origin)) return json(403, { error: 'Origin not allowed' });

  const keyId = process.env.CF_TURN_KEY_ID;
  const apiToken = process.env.CF_TURN_API_TOKEN;
  if (!keyId || !apiToken) return json(503, { error: 'TURN is not configured' });

  const res = await fetch(`https://rtc.live.cloudflare.com/v1/turn/keys/${keyId}/credentials/generate-ice-servers`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ ttl: TTL_SECONDS }),
  });
  if (!res.ok) {
    console.error('Cloudflare TURN credential request failed', res.status, await res.text());
    return json(502, { error: 'Could not obtain TURN credentials' });
  }

  const data = (await res.json()) as { iceServers?: IceServer[] };
  // Browsers block port 53, so those URLs would only ever time out.
  const iceServers = (data.iceServers ?? []).map((server) => ({
    ...server,
    urls: (Array.isArray(server.urls) ? server.urls : [server.urls]).filter((url) => !/:53(\?|$)/.test(url)),
  }));

  return json(200, { iceServers });
};

export const config = { path: '/api/ice-servers' };
