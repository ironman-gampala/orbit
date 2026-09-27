import { generateRoomId, MAX_ROOM_NAME_LENGTH, normalizeRoomName, roomSearch } from '../room';
import { h, icon, navigate, type Cleanup } from './dom';

export function renderBrand(): HTMLElement {
  return h('div', { class: 'brand' }, h('span', { class: 'brand-mark' }, icon('orbit')), h('span', {}, 'Orbit'));
}

export function mountLanding(container: HTMLElement): Cleanup {
  const input = h('input', {
    class: 'input',
    type: 'text',
    placeholder: 'Room name, number or link',
    'aria-label': 'Room name, number or link',
    autocomplete: 'off',
    spellcheck: 'false',
    maxLength: 500,
  });
  const joinButton = h('button', { class: 'btn btn-text', type: 'submit', disabled: true }, 'Join');

  input.addEventListener('input', () => {
    joinButton.disabled = !normalizeRoomName(input.value);
  });
  input.title = `Up to ${MAX_ROOM_NAME_LENGTH} characters`;

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

  const page = h(
    'main',
    { class: 'landing' },
    h('header', { class: 'topbar' }, renderBrand()),
    h(
      'section',
      { class: 'landing-hero' },
      h('h1', {}, 'Video calls, straight between browsers.'),
      h(
        'p',
        { class: 'lead' },
        'Private 1:1 calls powered by WebRTC. Your audio and video flow peer-to-peer; no accounts, no installs.',
      ),
      h(
        'div',
        { class: 'landing-actions' },
        h(
          'button',
          { class: 'btn btn-primary btn-lg', type: 'button', onClick: () => navigate(roomSearch(generateRoomId())) },
          icon('video'),
          'New call',
        ),
        form,
      ),
      h(
        'ul',
        { class: 'feature-list' },
        h('li', {}, 'Camera & mic preview before joining'),
        h('li', {}, 'Screen sharing'),
        h('li', {}, 'Peer-to-peer chat'),
      ),
    ),
  );

  container.replaceChildren(page);
  return () => page.remove();
}
