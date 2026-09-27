# Orbit

**Face to face, from anywhere.** Video rooms for up to ten people, straight between browsers.

**Live:** <https://orbitcall.netlify.app> · **How it's built:** [IMPLEMENTATION.md](IMPLEMENTATION.md)

![A four-person call in Orbit](docs/screenshots/05-group-call.png)

Orbit is a WebRTC video calling app with no accounts and no installs. Audio, video, screen share, chat and
captions travel **peer-to-peer** between the browsers in a room. [Supabase Realtime](https://supabase.com/docs/guides/realtime)
is used only so the browsers can find each other (signaling), and a [Cloudflare TURN](https://developers.cloudflare.com/realtime/turn/)
relay steps in when a network blocks direct connections. Nothing is stored in a database.

## Features

- **Rooms of up to ten:** a full mesh where everyone gets a tile in the grid. A presenter's screen takes centre
  stage, whoever is talking gets a highlight ring, and video quality scales down as the room fills so upload
  bandwidth stays sensible. An eleventh person sees "This room is full".
- **Any room name:** `Design sync`, `4021`, `Équipe produit`, or a pasted link. Names are case-insensitive, so
  `Design Sync` and `design sync` are the same room. "Start a room" still creates an unguessable code.
- **Live captions and transcript:** one switch turns on captions for the whole room. Each browser captions its
  own speaker, shares the lines with everyone, and a transcript of speech, chat and who came and went can be
  downloaded as a text file during or after the call.
- **A home page that remembers you:** a greeting for the time of day, your recent rooms with when you were last
  there, how long and with how many people, one-tap rejoin and saved transcripts. Your name, camera and mic
  choices are remembered too. It all lives in this browser's local storage.
- **Pre-join lobby:** camera preview, camera and mic pickers, live mic level meter, display name.
- **Call controls:** mute, camera on/off (really releases the camera), screen share, chat, captions, hang up;
  `⌘/Ctrl+D` and `⌘/Ctrl+E` shortcuts.
- **Resilience:** automatic ICE restart, TURN fallback (UDP/TCP/TLS 443), and a watchdog that rebuilds any
  connection that hasn't come up within 15 seconds.
- **Responsive:** works on phones and desktops.

| Home | Live captions | Transcript |
| --- | --- | --- |
| ![Home](docs/screenshots/01-home.png) | ![Live captions](docs/screenshots/07-live-captions.png) | ![Transcript](docs/screenshots/08-transcript.png) |

| Lobby | Mobile home | Mobile call |
| --- | --- | --- |
| ![Lobby](docs/screenshots/03-lobby.png) | ![Mobile home](docs/screenshots/02-home-mobile.png) | ![Mobile call](docs/screenshots/06-mobile-call.png) |

## Quick start

```bash
npm install
cp .env.example .env   # add your Supabase URL + publishable/anon key
npm run dev            # http://localhost:5173
```

Open the app, type any room name (or click **Start a room**), then open the same link in other browsers or devices.

Browsers only allow camera and microphone access on `https://` or `http://localhost`. Live captions use the
browser's speech recognition, which is available in Chrome, Edge and Safari.

### Supabase (signaling)

1. Create a free project at <https://supabase.com/dashboard>.
2. **Project Settings → API**: copy the **Project URL** and the **publishable** (or legacy **anon**) key into `.env`.
3. **Realtime → Settings**: make sure **Allow public access** is on (the default).

No tables or migrations are needed.

### Cloudflare TURN (relay, recommended)

VPNs such as Cloudflare WARP, corporate firewalls and many mobile networks block direct peer-to-peer traffic.
Orbit's Netlify function `/api/ice-servers` exchanges a Cloudflare TURN key for credentials that expire after
6 hours, so the key never reaches the browser.

1. Cloudflare dashboard → **Realtime → TURN Server → Create**.
2. Set these as Netlify environment variables (not `VITE_`-prefixed, so they stay server-side):

```bash
CF_TURN_KEY_ID=...
CF_TURN_API_TOKEN=...
```

Without them (or under plain `npm run dev`), Orbit falls back to public STUN plus any static TURN server in `.env`.
Use `netlify dev` to run the function locally.

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Vite dev server |
| `npm run build` | Typecheck + production build into `dist/` |
| `npm test` | Unit tests (Vitest) |
| `npm run e2e` | Two headless Chrome instances hold a real 1:1 call on the deployed site (`BASE_URL` to override) |
| `npm run e2e:group` | A group call with captions, transcript download and leaving (`PEOPLE=10`, `CAMERA=off`) |
| `npm run screenshots` | Regenerates `docs/screenshots` from the deployed site |

## Deploy (Netlify)

```bash
netlify sites:create --name <your-name>
netlify env:set VITE_SUPABASE_URL ...
netlify env:set VITE_SUPABASE_ANON_KEY ...
# plus CF_TURN_KEY_ID / CF_TURN_API_TOKEN for TURN
netlify deploy --prod
```

`netlify.toml` holds the build command, publish directory and camera/microphone permission headers.

## Tech

TypeScript + Vite (no UI framework), WebRTC, Web Speech API, Supabase Realtime (presence + REST broadcast),
Netlify Functions, Cloudflare TURN, Vitest and Puppeteer.

## Privacy and security notes

- Anyone who knows a room's name can join while there is a free seat. Pick an unusual name, or use
  **Start a room** for a random code (~8×10¹⁴ combinations).
- Media is always encrypted by WebRTC (DTLS-SRTP) and never passes through Supabase. TURN relays forward
  encrypted packets without being able to read them.
- Captions are produced by each speaker's browser speech service (in Chrome that is Google's), then shared
  peer-to-peer. Transcripts and recent rooms are kept only in local storage on your device.
- The Supabase publishable key is designed to be public. The Cloudflare TURN token lives only in Netlify's server environment.
