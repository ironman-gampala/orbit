import { h, type Cleanup } from './dom';
import { renderBrand } from './landing';

export interface MessageAction {
  label: string;
  primary?: boolean;
  onClick(): void;
}

export function mountMessage(
  container: HTMLElement,
  opts: { title: string; body?: string | Node; actions?: MessageAction[] },
): Cleanup {
  const page = h(
    'main',
    { class: 'message-screen' },
    h('header', { class: 'topbar' }, renderBrand()),
    h(
      'section',
      { class: 'message-card' },
      h('h1', {}, opts.title),
      opts.body ? h('div', { class: 'message-body' }, opts.body) : null,
      h(
        'div',
        { class: 'message-actions' },
        ...(opts.actions ?? []).map((a) =>
          h('button', { class: `btn ${a.primary ? 'btn-primary' : 'btn-outline'}`, type: 'button', onClick: a.onClick }, a.label),
        ),
      ),
    ),
  );
  container.replaceChildren(page);
  return () => page.remove();
}
