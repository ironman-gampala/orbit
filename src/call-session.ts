import type { AppConfig } from './config';
import { acquireCamera, acquireMicrophone, acquireScreen, canShareScreen, describeMediaError } from './media';
import { MAX_CHAT_LENGTH, type MediaState, type PeerMessage } from './messages';
import { PeerLink } from './peer';
import { randomId } from './room';
import { resolveRoster, type RosterEntry } from './roster';
import { SupabaseSignaling, type SignalPayload, type Signaling } from './signaling';

export type CallStatus =
  | { kind: 'joining' }
  | { kind: 'waiting' }
  | { kind: 'connecting' }
  | { kind: 'connected' }
  | { kind: 'reconnecting' }
  | { kind: 'full' }
  | { kind: 'ended' }
  | { kind: 'error'; message: string };

export interface ChatEntry {
  id: string;
  from: 'me' | 'peer';
  name: string;
  text: string;
  sentAt: number;
}

export interface RemoteInfo {
  name: string;
  media: MediaState;
}

export interface LocalMediaSnapshot {
  /** Video-only stream for the self-view tile (camera or screen). */
  preview: MediaStream;
  media: MediaState;
}

export interface CallSessionHandlers {
  onStatus(status: CallStatus): void;
  onRemoteStream(stream: MediaStream | null): void;
  onRemoteInfo(info: RemoteInfo | null): void;
  onLocalMedia(snapshot: LocalMediaSnapshot): void;
  onChat(entry: ChatEntry): void;
  onNotice(message: string): void;
}

export interface CallSessionOptions {
  config: AppConfig;
  roomId: string;
  name: string;
  stream: MediaStream;
  micOn: boolean;
  audioDeviceId?: string;
  videoDeviceId?: string;
  handlers: CallSessionHandlers;
}

export class CallSession {
  readonly selfId = randomId();
  readonly canShareScreen = canShareScreen();

  private readonly signaling: Signaling;
  private readonly handlers: CallSessionHandlers;
  private status: CallStatus = { kind: 'joining' };
  private link: PeerLink | null = null;
  private peerId: string | null = null;
  private peerSeenInRoster = false;
  private everConnected = false;
  private readonly departed = new Set<string>();
  private remoteName = '';

  private micTrack: MediaStreamTrack | null;
  private cameraTrack: MediaStreamTrack | null;
  private screenTrack: MediaStreamTrack | null = null;
  private micOn: boolean;
  private busy = false;

  constructor(private readonly opts: CallSessionOptions) {
    this.handlers = opts.handlers;
    this.micTrack = opts.stream.getAudioTracks()[0] ?? null;
    this.cameraTrack = opts.stream.getVideoTracks()[0] ?? null;
    this.micOn = opts.micOn && !!this.micTrack;
    if (this.micTrack) this.micTrack.enabled = this.micOn;

    this.signaling = new SupabaseSignaling({
      url: opts.config.supabaseUrl,
      anonKey: opts.config.supabaseAnonKey,
      roomId: opts.roomId,
      selfId: this.selfId,
      handlers: {
        onRoster: (entries) => this.handleRoster(entries),
        onSignal: (from, payload) => this.handleSignal(from, payload),
        onError: (message) => this.handlers.onNotice(message),
      },
    });
  }

  get localMedia(): MediaState {
    return { audio: this.micOn, video: !!this.cameraTrack, screen: !!this.screenTrack };
  }

  async start(): Promise<void> {
    window.addEventListener('pagehide', this.onPageHide);
    this.emitLocal();
    this.setStatus({ kind: 'joining' });
    try {
      await this.signaling.join();
      if (this.status.kind === 'joining') this.setStatus({ kind: 'waiting' });
    } catch (err) {
      this.teardown();
      this.setStatus({ kind: 'error', message: err instanceof Error ? err.message : String(err) });
    }
  }

  async hangUp(): Promise<void> {
    if (this.isFinished()) return;
    if (this.peerId) this.signaling.send(this.peerId, { kind: 'bye' });
    this.teardown();
    this.setStatus({ kind: 'ended' });
  }

  sendChat(text: string): boolean {
    const trimmed = text.trim().slice(0, MAX_CHAT_LENGTH);
    if (!trimmed || !this.link) return false;
    const message: PeerMessage = { type: 'chat', id: randomId(), text: trimmed, sentAt: Date.now() };
    if (!this.link.send(message)) return false;
    this.handlers.onChat({ id: message.id, from: 'me', name: this.opts.name, text: trimmed, sentAt: message.sentAt });
    return true;
  }

  async toggleMic(): Promise<void> {
    if (!this.micTrack) {
      await this.exclusive(async () => {
        this.micTrack = await acquireMicrophone(this.opts.audioDeviceId);
        this.micOn = true;
        await this.link?.replaceTrack('audio', this.micTrack);
      });
    } else {
      this.micOn = !this.micOn;
      this.micTrack.enabled = this.micOn;
    }
    this.mediaChanged();
  }

  async toggleCamera(): Promise<void> {
    await this.exclusive(async () => {
      if (this.cameraTrack) {
        // Stopping (not just disabling) the track turns the camera light off.
        this.cameraTrack.stop();
        this.cameraTrack = null;
      } else {
        this.cameraTrack = await acquireCamera(this.opts.videoDeviceId);
      }
      if (!this.screenTrack) await this.link?.replaceTrack('video', this.cameraTrack);
    });
    this.mediaChanged();
  }

  async toggleScreenShare(): Promise<void> {
    if (this.screenTrack) {
      await this.stopScreenShare();
      return;
    }
    await this.exclusive(async () => {
      let track: MediaStreamTrack;
      try {
        track = await acquireScreen();
      } catch (err) {
        if (err instanceof DOMException && err.name === 'NotAllowedError') return; // user cancelled the picker
        throw err;
      }
      track.addEventListener('ended', () => void this.stopScreenShare());
      this.screenTrack = track;
      await this.link?.replaceTrack('video', track);
    });
    this.mediaChanged();
  }

  private async stopScreenShare(): Promise<void> {
    if (!this.screenTrack) return;
    this.screenTrack.stop();
    this.screenTrack = null;
    await this.link?.replaceTrack('video', this.cameraTrack);
    this.mediaChanged();
  }

  private handleRoster(entries: RosterEntry[]): void {
    if (this.isFinished()) return;

    if (this.peerId) {
      const present = entries.some((e) => e.id === this.peerId);
      if (present) {
        this.peerSeenInRoster = true;
        return;
      }
      // A peer that reached us via signaling before its presence synced isn't gone.
      if (!this.peerSeenInRoster) return;
      this.dropPeer();
    }

    const roster = resolveRoster(entries.filter((e) => !this.departed.has(e.id)), this.selfId);
    if (roster.kind === 'full') {
      this.teardown();
      this.setStatus({ kind: 'full' });
    } else if (roster.kind === 'paired') {
      this.connectTo(roster.peerId);
      this.peerSeenInRoster = true;
    } else if (this.status.kind === 'joining') {
      this.setStatus({ kind: 'waiting' });
    }
  }

  private handleSignal(from: string, payload: SignalPayload): void {
    if (this.isFinished() || this.departed.has(from)) return;
    if (payload.kind === 'bye') {
      if (from === this.peerId) this.dropPeer();
      else this.departed.add(from);
      return;
    }
    if (!this.peerId) this.connectTo(from);
    if (from === this.peerId) this.link?.handleSignal(payload);
  }

  private connectTo(peerId: string): void {
    this.peerId = peerId;
    this.peerSeenInRoster = false;
    this.everConnected = false;
    this.link = new PeerLink({
      polite: this.selfId < peerId,
      iceServers: this.opts.config.iceServers,
      localTracks: { audio: this.micTrack, video: this.screenTrack ?? this.cameraTrack },
      sendSignal: (payload) => this.signaling.send(peerId, payload),
      onRemoteStream: (stream) => this.handlers.onRemoteStream(stream),
      onConnectionState: (state) => this.handleConnectionState(state),
      onChannelOpen: () => this.sendState(),
      onMessage: (message) => this.handleMessage(message),
    });
    this.setStatus({ kind: 'connecting' });
  }

  private dropPeer(): void {
    if (!this.peerId) return;
    const name = this.remoteName;
    this.departed.add(this.peerId);
    this.link?.close();
    this.link = null;
    this.peerId = null;
    this.remoteName = '';
    this.handlers.onRemoteStream(null);
    this.handlers.onRemoteInfo(null);
    this.handlers.onNotice(`${name || 'The other person'} left the call`);
    this.setStatus({ kind: 'waiting' });
  }

  private handleConnectionState(state: RTCPeerConnectionState): void {
    if (this.isFinished() || !this.link) return;
    if (state === 'connected') {
      this.everConnected = true;
      this.setStatus({ kind: 'connected' });
    } else if (state === 'disconnected' || state === 'failed') {
      this.setStatus({ kind: 'reconnecting' });
    } else if (state === 'connecting' || state === 'new') {
      this.setStatus({ kind: this.everConnected ? 'reconnecting' : 'connecting' });
    }
  }

  private handleMessage(message: PeerMessage): void {
    if (message.type === 'chat') {
      this.handlers.onChat({
        id: message.id,
        from: 'peer',
        name: this.remoteName || 'Guest',
        text: message.text,
        sentAt: message.sentAt,
      });
      return;
    }
    const firstState = !this.remoteName;
    this.remoteName = message.name.trim() || 'Guest';
    this.handlers.onRemoteInfo({ name: this.remoteName, media: message.media });
    if (firstState) this.handlers.onNotice(`${this.remoteName} joined the call`);
  }

  private sendState(): void {
    this.link?.send({ type: 'state', name: this.opts.name, media: this.localMedia });
  }

  private mediaChanged(): void {
    this.emitLocal();
    this.sendState();
  }

  private emitLocal(): void {
    const video = this.screenTrack ?? this.cameraTrack;
    this.handlers.onLocalMedia({ preview: new MediaStream(video ? [video] : []), media: this.localMedia });
  }

  private async exclusive(task: () => Promise<void>): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    try {
      await task();
    } catch (err) {
      this.handlers.onNotice(describeMediaError(err));
    } finally {
      this.busy = false;
    }
  }

  private setStatus(status: CallStatus): void {
    this.status = status;
    this.handlers.onStatus(status);
  }

  private isFinished(): boolean {
    return this.status.kind === 'ended' || this.status.kind === 'full' || this.status.kind === 'error';
  }

  private readonly onPageHide = () => {
    if (this.peerId) this.signaling.send(this.peerId, { kind: 'bye' });
  };

  private teardown(): void {
    window.removeEventListener('pagehide', this.onPageHide);
    this.link?.close();
    this.link = null;
    this.peerId = null;
    for (const track of [this.micTrack, this.cameraTrack, this.screenTrack]) track?.stop();
    this.micTrack = this.cameraTrack = this.screenTrack = null;
    void this.signaling.leave().catch(() => undefined);
  }
}
