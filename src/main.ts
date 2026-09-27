import './style.css';
import { loadConfig, type AppConfig } from './config';
import type { CallStatus } from './call-session';
import { roomFromLocation } from './room';
import { ROOM_CAPACITY } from './roster';
import { downloadText } from './transcript';
import { mountCall, type CallSummary } from './ui/call';
import { h, navigate, type Cleanup } from './ui/dom';
import { mountLanding } from './ui/landing';
import { mountLobby, type LobbyResult } from './ui/lobby';
import { mountMessage } from './ui/message-screen';

const app = document.getElementById('app')!;
let cleanup: Cleanup | null = null;

function show(mount: (container: HTMLElement) => Cleanup): void {
  cleanup?.();
  cleanup = mount(app);
}

function route(): void {
  const result = loadConfig();
  if (!result.ok) {
    show((c) =>
      mountMessage(c, {
        title: 'Supabase is not configured',
        body: h(
          'div',
          {},
          h('p', {}, 'Orbit uses Supabase Realtime to let browsers find each other. Add these to a ', h('code', {}, '.env'), ' file and restart the dev server:'),
          h('pre', {}, result.missing.map((k) => `${k}=...`).join('\n')),
          h('p', {}, 'See the README for step-by-step setup.'),
        ),
      }),
    );
    return;
  }

  const roomId = roomFromLocation();
  if (!roomId) {
    if (new URLSearchParams(location.search).has('room')) history.replaceState(null, '', location.pathname);
    show(mountLanding);
    return;
  }

  showLobby(result.config, roomId);
}

function showLobby(config: AppConfig, roomId: string): void {
  show((c) => mountLobby(c, { roomId, onJoin: (lobby) => showCall(config, roomId, lobby) }));
}

function showCall(config: AppConfig, roomId: string, lobby: LobbyResult): void {
  show((c) =>
    mountCall(c, { config, roomId, lobby, onFinished: (status, summary) => showFinished(config, roomId, status, summary) }),
  );
}

function showFinished(config: AppConfig, roomId: string, status: CallStatus, summary: CallSummary): void {
  const home = { label: 'Return to home screen', onClick: () => navigate('') };
  const rejoin = { label: 'Rejoin', primary: true, onClick: () => showLobby(config, roomId) };
  const transcript = summary.transcript;
  const download = transcript && {
    label: 'Download transcript',
    onClick: () => downloadText(transcript.filename, transcript.text),
  };

  // Defer so the call screen finishes its own status handler before being torn down.
  queueMicrotask(() => {
    if (status.kind === 'full') {
      show((c) =>
        mountMessage(c, {
          title: 'This room is full',
          body: `Orbit rooms hold up to ${ROOM_CAPACITY} people and this one is at capacity. Try again in a bit or start a new room.`,
          actions: [rejoin, home],
        }),
      );
    } else if (status.kind === 'error') {
      show((c) => mountMessage(c, { title: 'Could not join the call', body: status.message, actions: [rejoin, home] }));
    } else {
      show((c) =>
        mountMessage(c, {
          title: 'You left the call',
          body: transcript ? 'Your transcript is ready. It stays on this device until you download it.' : undefined,
          actions: download ? [rejoin, download, home] : [rejoin, home],
        }),
      );
    }
  });
}

window.addEventListener('popstate', route);
window.addEventListener('orbit:navigate', route);
route();
