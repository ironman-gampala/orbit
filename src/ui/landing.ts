import { generateRoomId, normalizeRoomId } from '../room';
import { h, icon, navigate, type Cleanup } from './dom';

export function renderBrand(): HTMLElement {
  return h('div', { class: 'brand' }, h('span', { class: 'brand-mark' }, icon('video')), h('span', {}, 'Meets'));
}

export function mountLanding(container: HTMLElement): Cleanup {
  const input = h('input', {
    class: 'input',
    type: 'text',
    placeholder: 'Enter a code or link',
    'aria-label': 'Meeting code or link',
    autocomplete: 'off',
    spellcheck: 'false',
  });
  const joinButton = h('button', { class: 'btn btn-text', type: 'submit', disabled: true }, 'Join');

  input.addEventListener('input', () => {
    joinButton.disabled = !normalizeRoomId(input.value);
  });

  const form = h(
    'form',
    {
      class: 'join-form',
      onSubmit: (event: Event) => {
        event.preventDefault();
        const room = normalizeRoomId(input.value);
        if (room) navigate(`?room=${room}`);
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
          { class: 'btn btn-primary btn-lg', type: 'button', onClick: () => navigate(`?room=${generateRoomId()}`) },
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
