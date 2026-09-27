import { generateRoomId, MAX_ROOM_NAME_LENGTH, normalizeRoomName, roomKey, roomSearch } from '../room';
import { store, type RecentRoom } from '../storage';
import { dayPart, formatDuration, formatWhen } from '../time';
import { downloadText } from '../transcript';
import { HOME_COPY as COPY } from './copy';
import { h, icon, navigate, showToast, type Cleanup } from './dom';

export function renderBrand(): HTMLElement {
  return h('div', { class: 'brand' }, h('span', { class: 'brand-mark' }, icon('orbit')), h('span', {}, 'Orbit'));
}

function greeting(name: string, returning: boolean): string {
  const first = name.trim().split(/\s+/)[0];
  const hello = COPY.greetings[dayPart()];
  return `${first ? `${hello}, ${first}` : hello}. ${returning ? COPY.welcomeBack : COPY.welcomeNew}`;
}

function roomHue(name: string): number {
  let hash = 0;
  for (const ch of roomKey(name)) hash = (hash * 31 + ch.codePointAt(0)!) >>> 0;
  return hash % 360;
}

export function mountLanding(container: HTMLElement): Cleanup {
  const name = store.getName();
  const returning = store.recentRooms().length > 0 || !!name;

  // Join by name, number or link
  const input = h('input', {
    class: 'input',
    type: 'text',
    placeholder: COPY.joinPlaceholder,
    'aria-label': 'Room name, number or link',
    autocomplete: 'off',
    spellcheck: 'false',
    maxLength: 500,
    title: `Up to ${MAX_ROOM_NAME_LENGTH} characters`,
  });
  const joinButton = h('button', { class: 'btn btn-join', type: 'submit', disabled: true }, COPY.join);
  const syncJoin = () => (joinButton.disabled = !normalizeRoomName(input.value));
  input.addEventListener('input', syncJoin);

  const form = h(
    'form',
    {
      class: 'join-form',
      onSubmit: (event: Event) => {
        event.preventDefault();
        const room = normalizeRoomName(input.value);
        if (room) navigate(roomSearch(room));
      },
    },
    input,
    joinButton,
  );

  // Clock
  const clock = h('span', { class: 'topbar-clock' });
  const renderClock = () => {
    const now = new Date();
    clock.textContent = `${now.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })} · ${now.toLocaleDateString([], {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
    })}`;
  };

  // Recent rooms
  const recentList = h('ol', { class: 'recent-list' });
  const recentEmpty = h(
    'div',
    { class: 'recent-empty' },
    h('span', { class: 'recent-empty-icon' }, icon('history')),
    h('p', {}, COPY.recentEmpty),
  );
  let clearArmed = 0;
  const clearButton = h('button', { class: 'btn btn-text btn-sm', type: 'button', onClick: () => clearAll() }, COPY.clear);
  const recentCard = h(
    'aside',
    { class: 'recent-card', 'aria-label': 'Recent rooms' },
    h('header', { class: 'recent-header' }, h('h2', {}, COPY.recentTitle), clearButton),
    recentEmpty,
    recentList,
  );

  function renderRecents() {
    const rooms = store.recentRooms();
    recentEmpty.hidden = rooms.length > 0;
    clearButton.hidden = rooms.length === 0;
    recentList.replaceChildren(...rooms.map(recentItem));
  }

  function recentItem(room: RecentRoom): HTMLElement {
    const meta = [formatWhen(room.lastJoinedAt)];
    if (room.lastDurationMs !== undefined) meta.push(formatDuration(room.lastDurationMs));
    if (room.lastPeople && room.lastPeople > 1) meta.push(`${room.lastPeople} people`);
    const transcript = room.transcriptId ? store.getTranscript(room.transcriptId) : null;

    return h(
      'li',
      { class: 'recent' },
      h('span', { class: 'recent-mark', style: `--hue: ${roomHue(room.name)}`, 'aria-hidden': 'true' }, Array.from(room.name)[0].toUpperCase()),
      h('div', { class: 'recent-info' }, h('strong', { title: room.name }, room.name), h('span', { class: 'recent-meta' }, meta.join(' · '))),
      h(
        'div',
        { class: 'recent-actions' },
        transcript &&
          h(
            'button',
            {
              class: 'icon-btn',
              type: 'button',
              title: 'Download transcript',
              'aria-label': `Download transcript for ${room.name}`,
              onClick: () => downloadText(transcript.filename, transcript.text),
            },
            icon('download'),
          ),
        h(
          'button',
          { class: 'btn btn-outline btn-sm', type: 'button', 'aria-label': `Rejoin ${room.name}`, onClick: () => navigate(roomSearch(room.name)) },
          'Rejoin',
        ),
        h(
          'button',
          {
            class: 'icon-btn',
            type: 'button',
            title: 'Remove from recent rooms',
            'aria-label': `Remove ${room.name} from recent rooms`,
            onClick: () => {
              store.removeRoom(room.name);
              renderRecents();
            },
          },
          icon('close'),
        ),
      ),
    );
  }

  function clearAll() {
    if (!clearArmed) {
      clearButton.textContent = COPY.clearConfirm;
      clearArmed = window.setTimeout(() => {
        clearArmed = 0;
        clearButton.textContent = COPY.clear;
      }, 3000);
      return;
    }
    window.clearTimeout(clearArmed);
    clearArmed = 0;
    clearButton.textContent = COPY.clear;
    store.clearRooms();
    renderRecents();
    showToast(COPY.cleared);
  }

  const page = h(
    'main',
    { class: 'landing' },
    h('header', { class: 'topbar' }, renderBrand(), clock),
    h(
      'section',
      { class: 'home' },
      h(
        'div',
        { class: 'home-main' },
        h('p', { class: 'greeting' }, icon(dayPart() === 'evening' || dayPart() === 'night' ? 'moon' : 'sun'), greeting(name, returning)),
        h('h1', {}, COPY.headline),
        h('p', { class: 'lead' }, COPY.lead),
        h(
          'div',
          { class: 'landing-actions' },
          h(
            'button',
            { class: 'btn btn-primary btn-lg', type: 'button', onClick: () => navigate(roomSearch(generateRoomId())) },
            icon('video'),
            COPY.newRoom,
          ),
          form,
        ),
        h('p', { class: 'privacy-note' }, icon('lock'), COPY.privacy),
      ),
      recentCard,
    ),
    h(
      'section',
      { class: 'features', 'aria-label': 'Features' },
      ...COPY.features.map((f) =>
        h('article', { class: 'feature' }, h('span', { class: 'feature-icon' }, icon(f.icon)), h('h3', {}, f.title), h('p', {}, f.body)),
      ),
    ),
  );

  renderClock();
  renderRecents();
  const clockTimer = window.setInterval(renderClock, 15_000);
  const onStorage = (e: StorageEvent) => e.key?.startsWith('orbit:') && renderRecents();
  window.addEventListener('storage', onStorage);
  container.replaceChildren(page);

  return () => {
    window.clearInterval(clockTimer);
    window.clearTimeout(clearArmed);
    window.removeEventListener('storage', onStorage);
    page.remove();
  };
}
