import { CallSession, type CallStatus, type ChatEntry, type LocalMediaSnapshot, type Participant } from '../call-session';
import type { AppConfig } from '../config';
import { MAX_CHAT_LENGTH } from '../messages';
import { roomUrl } from '../room';
import { ROOM_CAPACITY } from '../roster';
import { copyText, h, icon, showToast, type Cleanup, type IconName } from './dom';
import type { LobbyResult } from './lobby';
import { SpeakingMonitor } from './speaking';
import { VideoTile } from './tile';

export interface CallScreenOptions {
  config: AppConfig;
  roomId: string;
  lobby: LobbyResult;
  onFinished(status: CallStatus): void;
}

const isMac = /Mac|iPhone|iPad/.test(navigator.platform);
const MOD = isMac ? '⌘' : 'Ctrl';
const SELF = 'self';
const narrowQuery = window.matchMedia('(max-width: 860px)');

export function mountCall(container: HTMLElement, opts: CallScreenOptions): Cleanup {
  const link = roomUrl(opts.roomId);
  let status: CallStatus = { kind: 'joining' };
  let connectedAt = 0;
  let unread = 0;
  let chatOpen = false;

  // Stage: remote tiles first, self last, laid out by layout()
  const selfTile = new VideoTile(true);
  const remoteTiles = new Map<string, VideoTile>();
  const grid = h('div', { class: 'grid' }, selfTile.el);
  const overlayTitle = h('h2', {});
  const overlayBody = h('div', { class: 'overlay-body' });
  const overlay = h('div', { class: 'stage-overlay' }, overlayTitle, overlayBody);
  const stage = h('div', { class: 'stage' }, grid, overlay);

  const speaking = new SpeakingMonitor((id, isSpeaking) => {
    (id === SELF ? selfTile : remoteTiles.get(id))?.setSpeaking(isSpeaking);
  });

  // Controls
  const micButton = controlButton(() => void session.toggleMic());
  const camButton = controlButton(() => void session.toggleCamera());
  const screenButton = controlButton(() => void session.toggleScreenShare());
  const unreadBadge = h('span', { class: 'unread', hidden: true });
  const chatButton = controlButton(() => setChatOpen(!chatOpen));
  chatButton.append(icon('chat'), unreadBadge);
  chatButton.setAttribute('aria-label', 'Chat with everyone');
  chatButton.title = 'Chat';
  const hangupButton = h(
    'button',
    { class: 'round-btn danger wide', type: 'button', title: 'Leave call', 'aria-label': 'Leave call', onClick: () => void session.hangUp() },
    icon('hangup'),
  );
  const clock = h('span', { class: 'call-clock' });
  const statusDot = h('span', { class: 'status-dot' });
  const peopleCount = h('span', { class: 'people-count-value' }, '1');
  const people = h('span', { class: 'people-count', title: `Up to ${ROOM_CAPACITY} people` }, icon('people'), peopleCount);

  const controls = h(
    'footer',
    { class: 'call-bar' },
    h('div', { class: 'call-meta' }, statusDot, clock, h('span', { class: 'divider' }), h('span', { class: 'room-name', title: opts.roomId }, opts.roomId)),
    h('div', { class: 'call-controls' }, micButton, camButton, screenButton, chatButton, hangupButton),
    h('div', { class: 'call-side' }, people),
  );

  // Chat
  const chatList = h('ol', { class: 'chat-list', 'aria-live': 'polite' });
  const chatEmpty = h('p', { class: 'chat-empty' }, 'Messages go straight to everyone in the call and disappear when it ends.');
  const chatInput = h('input', {
    class: 'input chat-input',
    type: 'text',
    placeholder: 'Send a message',
    maxLength: MAX_CHAT_LENGTH,
    'aria-label': 'Chat message',
  });
  const chatSend = h('button', { class: 'icon-btn', type: 'submit', 'aria-label': 'Send message' }, icon('send'));
  const chatPanel = h(
    'aside',
    { class: 'chat-panel', hidden: true, 'aria-label': 'In-call messages' },
    h(
      'header',
      { class: 'chat-header' },
      h('h2', {}, 'In-call messages'),
      h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Close chat', onClick: () => setChatOpen(false) }, icon('close')),
    ),
    h('div', { class: 'chat-scroll' }, chatEmpty, chatList),
    h(
      'form',
      {
        class: 'chat-form',
        onSubmit: (event: Event) => {
          event.preventDefault();
          if (session.sendChat(chatInput.value)) chatInput.value = '';
          else if (chatInput.value.trim()) showToast('Chat opens as soon as someone else is connected.');
        },
      },
      chatInput,
      chatSend,
    ),
  );

  const page = h('main', { class: 'call' }, h('div', { class: 'call-main' }, stage, chatPanel), controls);
  container.replaceChildren(page);

  const session = new CallSession({
    config: opts.config,
    roomId: opts.roomId,
    name: opts.lobby.name,
    stream: opts.lobby.stream,
    micOn: opts.lobby.micOn,
    audioDeviceId: opts.lobby.audioDeviceId,
    videoDeviceId: opts.lobby.videoDeviceId,
    handlers: {
      onStatus: (next) => {
        status = next;
        if (next.kind === 'connected' && !connectedAt) connectedAt = Date.now();
        if (next.kind === 'waiting') connectedAt = 0;
        renderStatus();
        if (next.kind === 'ended' || next.kind === 'full' || next.kind === 'error') opts.onFinished(next);
      },
      onParticipants: (participants) => renderParticipants(participants),
      onLocalMedia: (snapshot) => renderLocal(snapshot),
      onChat: (entry) => addChat(entry),
      onNotice: (message) => showToast(message),
    },
  });

  function controlButton(onClick: () => void): HTMLButtonElement {
    return h('button', { class: 'round-btn', type: 'button', onClick });
  }

  function setControl(button: HTMLButtonElement, iconName: IconName, off: boolean, label: string, active = false) {
    button.replaceChildren(icon(iconName));
    button.classList.toggle('is-off', off);
    button.classList.toggle('is-active', active);
    button.setAttribute('aria-label', label);
    button.title = label;
  }

  function renderLocal({ preview, mic, media }: LocalMediaSnapshot) {
    selfTile.update({ name: opts.lobby.name, media, stream: preview.getVideoTracks().length ? preview : null, connection: 'connected' });
    speaking.watch(SELF, mic);

    setControl(micButton, media.audio ? 'mic' : 'micOff', !media.audio, `${media.audio ? 'Turn off' : 'Turn on'} microphone (${MOD}+D)`);
    setControl(camButton, media.video ? 'cam' : 'camOff', !media.video, `${media.video ? 'Turn off' : 'Turn on'} camera (${MOD}+E)`);
    setControl(screenButton, 'screen', false, media.screen ? 'Stop presenting' : 'Present your screen', media.screen);
    screenButton.hidden = !session.canShareScreen;
    layout();
  }

  function renderParticipants(participants: Participant[]) {
    const ids = new Set(participants.map((p) => p.id));
    for (const [id, tile] of remoteTiles) {
      if (ids.has(id)) continue;
      tile.el.remove();
      remoteTiles.delete(id);
      speaking.unwatch(id);
    }
    for (const participant of participants) {
      let tile = remoteTiles.get(participant.id);
      if (!tile) {
        tile = new VideoTile(false);
        grid.insertBefore(tile.el, selfTile.el);
        remoteTiles.set(participant.id, tile);
      }
      tile.update(participant);
      speaking.watch(participant.id, participant.stream?.getAudioTracks()[0] ?? null);
    }
    peopleCount.textContent = String(participants.length + 1);
    page.dataset.people = String(participants.length + 1);
    layout();
    renderStatus();
  }

  /**
   * solo: just you, waiting. pair: the other person fills the stage with you
   * floating in the corner. grid: everyone in equal tiles. spotlight: a remote
   * screen share takes the stage and everyone else lines up beside it.
   */
  function layout() {
    const remotes = [...remoteTiles.values()];
    const presenter = remotes.find((t) => t.presenting);
    const total = remotes.length + 1;
    const narrow = narrowQuery.matches;
    const mode = remotes.length === 0 ? 'solo' : remotes.length === 1 ? 'pair' : presenter && !narrow ? 'spotlight' : 'grid';
    page.dataset.layout = mode;

    for (const tile of remotes) tile.el.classList.toggle('spotlight', mode === 'spotlight' && tile === presenter);

    let cols = 1;
    let rows = 1;
    if (mode === 'grid') {
      cols = narrow ? (total <= 3 ? 1 : 2) : Math.ceil(Math.sqrt(total));
      rows = Math.ceil(total / cols);
    } else if (mode === 'spotlight') {
      cols = 2;
      rows = total - 1;
    }
    grid.style.setProperty('--cols', String(cols));
    grid.style.setProperty('--rows', String(rows));
  }

  function renderStatus() {
    page.dataset.status = status.kind;
    const fewPeople = remoteTiles.size <= 1;
    const showOverlay =
      status.kind === 'joining' ||
      status.kind === 'waiting' ||
      ((status.kind === 'connecting' || status.kind === 'reconnecting') && fewPeople);
    overlay.hidden = !showOverlay;
    overlayBody.replaceChildren();

    switch (status.kind) {
      case 'joining':
        overlayTitle.textContent = 'Joining…';
        break;
      case 'waiting':
        overlayTitle.textContent = 'You’re the first one here';
        overlayBody.append(
          h('p', {}, `Share this link with anyone you want in the room. Up to ${ROOM_CAPACITY} people can join.`),
          h(
            'div',
            { class: 'share-link' },
            h('input', { class: 'input', readOnly: true, value: link, 'aria-label': 'Call link', onFocus: (e: Event) => (e.target as HTMLInputElement).select() }),
            h(
              'button',
              { class: 'btn btn-primary', type: 'button', onClick: async () => showToast((await copyText(link)) ? 'Link copied' : 'Copy failed. Select the link and copy it manually.') },
              icon('copy'),
              'Copy',
            ),
          ),
        );
        break;
      case 'connecting':
        overlayTitle.textContent = 'Connecting…';
        overlayBody.append(h('p', {}, 'Setting up a direct connection.'));
        break;
      case 'reconnecting':
        overlayTitle.textContent = 'Reconnecting…';
        overlayBody.append(h('p', {}, 'The connection was interrupted. Trying to restore it.'));
        break;
      default:
        overlayTitle.textContent = '';
    }
    renderClock();
  }

  function renderClock() {
    if (!connectedAt) {
      clock.textContent = status.kind === 'waiting' ? 'Waiting' : status.kind === 'connected' ? '0:00' : '…';
      return;
    }
    const total = Math.floor((Date.now() - connectedAt) / 1000);
    const hours = Math.floor(total / 3600);
    const minutes = Math.floor((total % 3600) / 60);
    const seconds = String(total % 60).padStart(2, '0');
    clock.textContent = hours ? `${hours}:${String(minutes).padStart(2, '0')}:${seconds}` : `${minutes}:${seconds}`;
  }

  function addChat(entry: ChatEntry) {
    chatEmpty.hidden = true;
    const time = new Date(entry.sentAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    chatList.append(
      h(
        'li',
        { class: `chat-message from-${entry.from}` },
        h('div', { class: 'chat-meta' }, h('strong', {}, entry.from === 'me' ? 'You' : entry.name), h('time', {}, time)),
        h('p', {}, entry.text),
      ),
    );
    chatList.parentElement!.scrollTop = chatList.parentElement!.scrollHeight;
    if (entry.from === 'peer' && !chatOpen) {
      unread += 1;
      renderUnread();
      showToast(`${entry.name}: ${entry.text.length > 80 ? `${entry.text.slice(0, 80)}…` : entry.text}`);
    }
  }

  function renderUnread() {
    unreadBadge.hidden = unread === 0;
    unreadBadge.textContent = unread > 9 ? '9+' : String(unread);
  }

  function setChatOpen(open: boolean) {
    chatOpen = open;
    chatPanel.hidden = !open;
    page.classList.toggle('chat-open', open);
    chatButton.classList.toggle('is-active', open);
    if (open) {
      unread = 0;
      renderUnread();
      chatInput.focus();
    }
  }

  const onKeyDown = (event: KeyboardEvent) => {
    if (!(isMac ? event.metaKey : event.ctrlKey)) return;
    const key = event.key.toLowerCase();
    if (key === 'd') {
      event.preventDefault();
      void session.toggleMic();
    } else if (key === 'e') {
      event.preventDefault();
      void session.toggleCamera();
    }
  };
  window.addEventListener('keydown', onKeyDown);
  narrowQuery.addEventListener('change', layout);
  const clockTimer = window.setInterval(renderClock, 1000);

  renderStatus();
  void session.start();

  return () => {
    window.removeEventListener('keydown', onKeyDown);
    narrowQuery.removeEventListener('change', layout);
    window.clearInterval(clockTimer);
    speaking.destroy();
    void session.hangUp();
    page.remove();
  };
}
