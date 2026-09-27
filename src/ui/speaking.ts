const POLL_MS = 120;
const THRESHOLD = 0.035;
const HOLD_MS = 600;

interface Watched {
  track: MediaStreamTrack;
  source: MediaStreamAudioSourceNode;
  analyser: AnalyserNode;
  data: Uint8Array<ArrayBuffer>;
  lastLoud: number;
  speaking: boolean;
}

/**
 * Flags who is talking. One AudioContext is shared by every participant
 * because browsers cap how many can exist at once. Remote tracks must also be
 * playing in a media element for Chrome to feed audio into Web Audio, which
 * the tiles already do.
 */
export class SpeakingMonitor {
  private ctx: AudioContext | null = null;
  private readonly watched = new Map<string, Watched>();
  private timer = 0;

  constructor(private readonly onChange: (id: string, speaking: boolean) => void) {}

  watch(id: string, track: MediaStreamTrack | null): void {
    const current = this.watched.get(id);
    if (current?.track === track) return;
    if (current) this.unwatch(id);
    if (!track) return;

    const AudioCtx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    this.ctx ??= new AudioCtx();
    void this.ctx.resume().catch(() => undefined);
    const source = this.ctx.createMediaStreamSource(new MediaStream([track]));
    const analyser = this.ctx.createAnalyser();
    analyser.fftSize = 512;
    source.connect(analyser);
    this.watched.set(id, { track, source, analyser, data: new Uint8Array(analyser.fftSize), lastLoud: 0, speaking: false });
    this.timer ||= window.setInterval(() => this.poll(), POLL_MS);
  }

  unwatch(id: string): void {
    const entry = this.watched.get(id);
    if (!entry) return;
    entry.source.disconnect();
    this.watched.delete(id);
    if (entry.speaking) this.onChange(id, false);
  }

  destroy(): void {
    for (const id of [...this.watched.keys()]) this.unwatch(id);
    window.clearInterval(this.timer);
    this.timer = 0;
    void this.ctx?.close().catch(() => undefined);
    this.ctx = null;
  }

  private poll(): void {
    const now = performance.now();
    for (const [id, entry] of this.watched) {
      entry.analyser.getByteTimeDomainData(entry.data);
      let sum = 0;
      for (const v of entry.data) {
        const centered = (v - 128) / 128;
        sum += centered * centered;
      }
      if (Math.sqrt(sum / entry.data.length) > THRESHOLD) entry.lastLoud = now;
      const speaking = now - entry.lastLoud < HOLD_MS;
      if (speaking !== entry.speaking) {
        entry.speaking = speaking;
        this.onChange(id, speaking);
      }
    }
  }
}
