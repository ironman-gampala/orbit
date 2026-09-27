# Meets

A 1:1 video calling app that runs entirely in the browser. Audio, video, screen
share and chat flow **peer-to-peer over WebRTC**; [Supabase Realtime](https://supabase.com/docs/guides/realtime)
is used only so the two browsers can find each other (signaling). No database
tables, no accounts, nothing is stored.

## Features

- Shareable room links (`/?room=abc-defg-hjk`) with a Meet-style code
- Pre-join lobby: camera preview, camera/mic pickers, live mic level meter, name
- Mute / camera on-off / hang up (`⌘/Ctrl + D` mic, `⌘/Ctrl + E` camera)
- Screen sharing (swaps the outgoing video track without renegotiating)
- Peer-to-peer text chat over an `RTCDataChannel`
- Remote mute / camera-off / presenting indicators
- Automatic ICE restart on connection failure, "room is full" for a third person

## Setup

1. **Create a Supabase project** (free tier is fine) at <https://supabase.com/dashboard>.
2. In the project, open **Project Settings → API** and copy the **Project URL** and the **anon public** key.
3. Make sure Realtime allows public channels: **Realtime → Settings → "Allow public access"** should be enabled (it is by default).
4. Configure the app:

   ```bash
   cp .env.example .env
   # then fill in VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY
   ```

5. Install and run:

   ```bash
   npm install
   npm run dev
   ```

6. Open the printed URL, click **New call**, then open the same link in another tab, browser, or device.

> Browsers only allow camera/mic access on `https://` or `http://localhost`.

## Scripts

| Command             | What it does                           |
| ------------------- | -------------------------------------- |
| `npm run dev`       | Vite dev server with hot reload        |
| `npm run build`     | Typecheck + production build (`dist/`) |
| `npm run preview`   | Serve the production build locally     |
| `npm test`          | Unit tests (Vitest)                    |
| `npm run typecheck` | TypeScript only                        |

## TURN (optional)

The app uses Google's public STUN servers, which work for most home networks. Peers behind symmetric NAT
or strict corporate firewalls need a TURN relay. Add one in `.env`:

```bash
VITE_TURN_URLS=turn:turn.example.com:3478,turns:turn.example.com:5349
VITE_TURN_USERNAME=user
VITE_TURN_CREDENTIAL=secret
```

Note that `VITE_*` values are bundled into the client; use short-lived TURN credentials for anything public.

## How it works

| File                  | Responsibility                                                           |
| --------------------- | ------------------------------------------------------------------------ |
| `src/signaling.ts`    | Supabase channel "meets:<room>": presence roster + addressed SDP/ICE     |
| `src/roster.ts`       | Who's in the call, who's turned away, who is the "polite" peer           |
| `src/peer.ts`         | `RTCPeerConnection` with perfect negotiation, data channel, replaceTrack |
| `src/call-session.ts` | Orchestrates signaling, peer link and local media for the UI             |
| `src/media.ts`        | getUserMedia/getDisplayMedia, device lists, mic level meter              |
| `src/messages.ts`     | Validated chat/state messages sent over the data channel                 |
| `src/ui/*`            | Landing, lobby, call and message screens (vanilla TS + DOM)              |

Media is always encrypted by WebRTC (DTLS-SRTP) and never passes through Supabase; only the small
connection-setup messages do.
