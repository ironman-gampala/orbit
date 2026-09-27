import type { ConnectionHealth } from '../call-session';
import type { MediaState } from '../messages';
import { attachStream, h, icon, initials } from './dom';

export interface TileState {
  name: string;
  media: MediaState | null;
  stream: MediaStream | null;
  connection: ConnectionHealth;
}

/** One person's video (or avatar when their camera is off) with name, mute and speaking cues. */
export class VideoTile {
  readonly el: HTMLElement;
  private readonly video: HTMLVideoElement;
  private readonly avatar: HTMLElement;
  private readonly nameText: HTMLElement;
  private readonly micOff: HTMLElement;
  private readonly health: HTMLElement;
  presenting = false;

  constructor(private readonly self: boolean) {
    this.video = h('video', { class: 'tile-video', autoplay: true, playsInline: true, muted: self });
    this.avatar = h('div', { class: 'avatar avatar-lg' });
    this.nameText = h('span', { class: 'name-tag-text' });
    this.micOff = h('span', { class: 'badge-muted', hidden: true, title: self ? 'You are muted' : 'Muted' }, icon('micOff'));
    this.health = h('span', { class: 'tile-health', hidden: true });
    this.el = h(
      'div',
      { class: `tile ${self ? 'self-tile' : 'remote-tile'} video-off` },
      this.video,
      h('div', { class: 'tile-avatar' }, this.avatar),
      this.health,
      h('div', { class: 'name-tag' }, this.micOff, this.nameText),
    );
  }

  update(state: TileState): void {
    const media = state.media;
    const name = this.self ? 'You' : state.name || 'Joining…';
    this.presenting = !!media?.screen;
    this.nameText.textContent = this.presenting ? `${name} (presenting)` : name;
    this.avatar.textContent = initials(this.self ? state.name : state.name || '?');
    this.micOff.hidden = !media || media.audio;

    attachStream(this.video, state.stream);
    const hasVideo = !!state.stream?.getVideoTracks().length;
    const showVideo = hasVideo && (!media || media.video || media.screen);
    this.el.classList.toggle('video-off', !showVideo);
    this.el.classList.toggle('presenting', this.presenting);
    this.video.classList.toggle('mirrored', this.self && !this.presenting);

    this.health.hidden = state.connection === 'connected';
    this.health.textContent = state.connection === 'reconnecting' ? 'Reconnecting…' : 'Connecting…';
    this.el.dataset.connection = state.connection;
  }

  setSpeaking(speaking: boolean): void {
    this.el.classList.toggle('speaking', speaking);
  }
}
