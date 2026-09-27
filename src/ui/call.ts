import { CallSession, type CallStatus, type ChatEntry, type LocalMediaSnapshot, type RemoteInfo } from '../call-session';
import type { AppConfig } from '../config';
import { MAX_CHAT_LENGTH } from '../messages';
import { roomUrl } from '../room';
import { attachStream, copyText, h, icon, initials, showToast, type Cleanup, type IconName } from './dom';
import type { LobbyResult } from './lobby';

export interface CallScreenOptions {
  config: AppConfig;
  roomId: string;
  lobby: LobbyResult;
  onFinished(status: CallStatus): void;
}

const isMac = /Mac|iPhone|iPad/.test(navigator.platform);
const MOD = isMac ? '⌘' : 'Ctrl';

export function mountCall(container: HTMLElement, opts: CallScreenOptions): Cleanup {
  const link = roomUrl(opts.roomId);
  let remote: RemoteInfo | null = null;
  let hasRemoteVideo = false;
  let status: CallStatus = { kind: 'joining' };
  let connectedAt = 0;
  let unread = 0;
  let chatOpen = false;

  // Remote stage
  const remoteVideo = h('video', { class: 'stage-video', autoplay: true, playsInline: true });
  const remoteAvatar = h('div', { class: 'avatar avatar-xl' });
  const remoteName = h('span', { class: 'name-tag-text' });
  const remoteMicOff = h('span', { class: 'badge-muted', hidden: true, title: 'Muted' }, icon('micOff'));
  const overlayTitle = h('h2', {});
  const overlayBody = h('div', { class: 'overlay-body' });
  const overlay = h('div', { class: 'stage-overlay' }, overlayTitle, overlayBody);
  const stage = h(
    'div',
    { class: 'stage video-off' },
    remoteVideo,
    h('div', { class: 'tile-avatar' }, remoteAvatar),
    h('div', { class: 'name-tag' }, remoteMicOff, remoteName),
    overlay,
  );

  // Self view
  const selfVideo = h('video', { class: 'tile-video mirrored', autoplay: true, playsInline: true, muted: true });
  const selfAvatar = h('div', { class: 'avatar' }, initials(opts.lobby.name));
  const selfMicOff = h('span', { class: 'badge-muted', hidden: true, title: 'You are muted' }, icon('micOff'));
  const selfTile = h(
    'div',
    { class: 'tile self-tile video-off' },
    selfVideo,
    h('div', { class: 'tile-avatar' }, selfAvatar),
    h('div', { class: 'name-tag' }, selfMicOff, h('span', { class: 'name-tag-text' }, 'You')),
  );

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

  const controls = h(
    'footer',
    { class: 'call-bar' },
    h('div', { class: 'call-meta' }, statusDot, clock, h('span', { class: 'divider' }), h('span', { class: 'room-code' }, opts.roomId)),
    h('div', { class: 'call-controls' }, micButton, camButton, screenButton, hangupButton),
    h('div', { class: 'call-side' }, chatButton),
  );

  // Chat
  const chatList = h('ol', { class: 'chat-list', 'aria-live': 'polite' });
  const chatEmpty = h('p', { class: 'chat-empty' }, 'Messages are sent directly to the other person and disappear when the call ends.');
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
          else if (chatInput.value.trim()) showToast('Chat is available once the other person is connected.');
        },
      },
      chatInput,
      chatSend,
    ),
  );

  const page = h('main', { class: 'call' }, h('div', { class: 'call-main' }, stage, selfTile, chatPanel), controls);
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
      onRemoteStream: (stream) => {
        hasRemoteVideo = !!stream?.getVideoTracks().length;
        attachStream(remoteVideo, stream);
        renderRemote();
      },
      onRemoteInfo: (info) => {
        remote = info;
        renderRemote();
      },
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

  function renderLocal({ preview, media }: LocalMediaSnapshot) {
    attachStream(selfVideo, preview.getVideoTracks().length ? preview : null);
    selfTile.classList.toggle('video-off', !preview.getVideoTracks().length);
    selfVideo.classList.toggle('mirrored', !media.screen);
    selfMicOff.hidden = media.audio;

    setControl(micButton, media.audio ? 'mic' : 'micOff', !media.audio, `${media.audio ? 'Turn off' : 'Turn on'} microphone (${MOD}+D)`);
    setControl(camButton, media.video ? 'cam' : 'camOff', !media.video, `${media.video ? 'Turn off' : 'Turn on'} camera (${MOD}+E)`);
    setControl(screenButton, 'screen', false, media.screen ? 'Stop presenting' : 'Present your screen', media.screen);
    screenButton.hidden = !session.canShareScreen;
  }

  function renderRemote() {
    const name = remote?.name ?? 'Guest';
    remoteName.textContent = remote ? (remote.media.screen ? `${name} (presenting)` : name) : '';
    remoteAvatar.textContent = initials(name);
    remoteMicOff.hidden = !remote || remote.media.audio;
    const showVideo = hasRemoteVideo && (!remote || remote.media.video || remote.media.screen);
    stage.classList.toggle('video-off', !showVideo);
    stage.classList.toggle('presenting', !!remote?.media.screen);
  }

  function renderStatus() {
    page.dataset.status = status.kind;
    overlay.hidden = status.kind === 'connected';
    overlayBody.replaceChildren();

    switch (status.kind) {
      case 'joining':
        overlayTitle.textContent = 'Joining…';
        break;
      case 'waiting':
        overlayTitle.textContent = 'Waiting for someone to join';
        overlayBody.append(
          h('p', {}, 'Share this link with the person you want to talk to:'),
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
  const clockTimer = window.setInterval(renderClock, 1000);

  renderStatus();
  void session.start();

  return () => {
    window.removeEventListener('keydown', onKeyDown);
    window.clearInterval(clockTimer);
    void session.hangUp();
    page.remove();
  };
}
