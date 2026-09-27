type Child = Node | string | number | null | undefined | false;
type Props = Record<string, unknown>;

export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Props = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value === undefined || value === null || value === false) continue;
    if (key.startsWith('on') && typeof value === 'function') {
      el.addEventListener(key.slice(2).toLowerCase(), value as EventListener);
    } else if (key === 'class') {
      el.className = String(value);
    } else if (key in el && typeof value !== 'string') {
      (el as unknown as Record<string, unknown>)[key] = value;
    } else {
      el.setAttribute(key, value === true ? '' : String(value));
    }
  }
  append(el, ...children);
  return el;
}

export function append(parent: Node, ...children: Child[]): void {
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    parent.appendChild(child instanceof Node ? child : document.createTextNode(String(child)));
  }
}

const ICONS = {
  mic: '<path d="M12 14a3 3 0 0 0 3-3V5a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3Zm5-3a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.92V21h2v-3.08A7 7 0 0 0 19 11h-2Z"/>',
  micOff:
    '<path d="M19 11h-2c0 .74-.16 1.43-.43 2.05l1.47 1.47A6.95 6.95 0 0 0 19 11Zm-4 .17V5a3 3 0 0 0-5.94-.6L15 10.34v.83ZM4.27 3 3 4.27l6 6V11a3 3 0 0 0 4.24 2.73l1.5 1.5A4.97 4.97 0 0 1 7 11H5a7 7 0 0 0 6 6.92V21h2v-3.08a6.9 6.9 0 0 0 2.99-1.07L19.73 21 21 19.73 4.27 3Z"/>',
  cam: '<path d="M17 10.5V7a1 1 0 0 0-1-1H4a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-3.5l4 4v-11l-4 4Z"/>',
  camOff:
    '<path d="M21 6.5l-4 4V7a1 1 0 0 0-1-1H9.82L21 17.18V6.5ZM3.27 2 2 3.27 4.73 6H4a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h12c.21 0 .39-.08.54-.18L19.73 21 21 19.73 3.27 2Z"/>',
  screen:
    '<path d="M20 18a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2H0v2h24v-2h-4ZM4 6h16v10H4V6Zm8 1-4 4h3v3h2v-3h3l-4-4Z"/>',
  chat: '<path d="M20 2H4a2 2 0 0 0-2 2v18l4-4h14a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2Zm0 14H5.17L4 17.17V4h16v12Z"/>',
  hangup:
    '<path d="M12 9c-1.6 0-3.15.25-4.6.72v3.1c0 .39-.23.74-.56.9-.98.49-1.87 1.12-2.66 1.85-.18.18-.43.28-.7.28a1 1 0 0 1-.71-.29L.29 13.08A1 1 0 0 1 0 12.37c0-.28.11-.53.29-.71A16.9 16.9 0 0 1 12 7c4.46 0 8.49 1.73 11.71 4.66.18.18.29.43.29.71 0 .28-.11.53-.29.71l-2.48 2.48a1 1 0 0 1-.71.29c-.27 0-.52-.11-.7-.28a11.3 11.3 0 0 0-2.67-1.85 1 1 0 0 1-.56-.9v-3.1A15 15 0 0 0 12 9Z"/>',
  copy: '<path d="M16 1H4a2 2 0 0 0-2 2v14h2V3h12V1Zm3 4H8a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2Zm0 16H8V7h11v14Z"/>',
  send: '<path d="M2.01 21 23 12 2.01 3 2 10l15 2-15 2z"/>',
  close:
    '<path d="M19 6.41 17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/>',
  video: '<path d="M17 10.5V7a1 1 0 0 0-1-1H4a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-3.5l4 4v-11l-4 4Z"/>',
  orbit:
    '<circle cx="12" cy="12" r="4.2"/><ellipse cx="12" cy="12" rx="10" ry="4.6" fill="none" stroke="currentColor" stroke-width="1.8" transform="rotate(-28 12 12)"/><circle cx="20.2" cy="7.4" r="1.9"/>',
} as const;

export type IconName = keyof typeof ICONS;

export function icon(name: IconName): SVGSVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  svg.classList.add('icon');
  svg.innerHTML = ICONS[name];
  return svg;
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase();
}

export function showToast(message: string, kind: 'info' | 'error' = 'info'): void {
  const host = document.getElementById('toasts');
  if (!host) return;
  const toast = h('div', { class: `toast toast-${kind}`, role: kind === 'error' ? 'alert' : 'status' }, message);
  host.appendChild(toast);
  setTimeout(() => {
    toast.classList.add('toast-leaving');
    setTimeout(() => toast.remove(), 300);
  }, 4000);
}

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

export function attachStream(video: HTMLVideoElement, stream: MediaStream | null): void {
  if (video.srcObject === stream) return;
  video.srcObject = stream;
  if (stream) video.play().catch(() => undefined);
}

export function navigate(search: string): void {
  history.pushState(null, '', search || window.location.pathname);
  window.dispatchEvent(new Event('orbit:navigate'));
}

/** A UI screen mounts into a container and returns a cleanup function. */
export type Cleanup = () => void;
