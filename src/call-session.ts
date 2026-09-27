import { videoEncodingFor } from './bandwidth';
import type { AppConfig } from './config';
import { fetchIceServers } from './ice';
import { acquireCamera, acquireMicrophone, acquireScreen, canShareScreen, describeMediaError } from './media';
import { MAX_CAPTION_LENGTH, MAX_CHAT_LENGTH, type MediaState, type PeerMessage } from './messages';
import { PeerLink } from './peer';
import { randomId } from './room';
import { ROOM_CAPACITY, resolveRoster, type RosterEntry } from './roster';
import { SupabaseSignaling, type SignalPayload, type Signaling } from './signaling';
import { Captioner, speechRecognitionSupported, type CaptionResult } from './speech';
import { Transcript, type TranscriptEntry } from './transcript';

/** Remote clocks can be off; keep their timestamps within this window of ours. */
const MAX_CLOCK_SKEW_MS = 60_000;
/** A pair that hasn't connected by now probably lost a signaling message. */
const STALL_TIMEOUT_MS = 15_000;
const MAX_RESETS = 3;

export type CallStatus =
  | { kind: 'joining' }
  | { kind: 'waiting' }
  | { kind: 'connecting' }
  | { kind: 'connected' }
  | { kind: 'reconnecting' }
  | { kind: 'full' }
  | { kind: 'ended' }
  | { kind: 'error'; message: string };

export type ConnectionHealth = 'connecting' | 'connected' | 'reconnecting';

export interface ChatEntry {
  id: string;
  from: 'me' | 'peer';
  name: string;
  text: string;
  sentAt: number;
}

export interface Participant {
  id: string;
  /** Empty until the peer's first state message arrives over the data channel. */
  name: string;
  media: MediaState | null;
  stream: MediaStream | null;
  connection: ConnectionHealth;
}

export interface LocalMediaSnapshot {
  /** Video-only stream for the self-view tile (camera or screen). */
  preview: MediaStream;
  /** Live microphone track, for the local speaking indicator. */
  mic: MediaStreamTrack | null;
  media: MediaState;
}

export interface Caption {
  /** 'self' for the local speaker, otherwise the peer id. */
  speakerId: string;
  name: string;
  text: string;
  final: boolean;
}

export interface TranscriptionState {
  on: boolean;
  /** Who flipped the switch most recently ('You' when it was us). */
  by: string;
  /** Whether this browser can transcribe the local microphone. */
  supported: boolean;
}

export interface CallSessionHandlers {
  onStatus(status: CallStatus): void;
  onParticipants(participants: Participant[]): void;
  onLocalMedia(snapshot: LocalMediaSnapshot): void;
  onChat(entry: ChatEntry): void;
  onNotice(message: string): void;
  onCaption(caption: Caption): void;
  onTranscription(state: TranscriptionState): void;
  onTranscript(entries: readonly TranscriptEntry[]): void;
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

interface PeerState extends Participant {
  link: PeerLink;
  everConnected: boolean;
  /** A peer that reaches us via signaling before its presence syncs isn't gone yet. */
  seenInRoster: boolean;
  resets: number;
  stallTimer: number;
}

export class CallSession {
  readonly selfId = randomId();
  readonly canShareScreen = canShareScreen();
  readonly transcript = new Transcript();
  readonly startedAt = Date.now();
  /** Most people in the room at once, including us. */
  peakParticipants = 1;

  private transcription = { on: false, at: 0, by: '' };
  private captioner: Captioner | null = null;
  private readonly captionStarts = new Map<string, number>();

  private readonly signaling: Signaling;
  private readonly handlers: CallSessionHandlers;
  private status: CallStatus = { kind: 'joining' };
  private joined = false;
  private admitted = false;
  private readonly peers = new Map<string, PeerState>();
  private readonly departed = new Set<string>();
  private iceServers: RTCIceServer[];

  private micTrack: MediaStreamTrack | null;
  private cameraTrack: MediaStreamTrack | null;
  private screenTrack: MediaStreamTrack | null = null;
  private micOn: boolean;
  private busy = false;

  constructor(private readonly opts: CallSessionOptions) {
    this.handlers = opts.handlers;
    this.iceServers = opts.config.iceServers;
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

  get participantCount(): number {
    return this.peers.size + 1;
  }

  async start(): Promise<void> {
    window.addEventListener('pagehide', this.onPageHide);
    this.emitLocal();
    this.setStatus({ kind: 'joining' });
    try {
      this.iceServers = await fetchIceServers(this.opts.config.iceServers);
      if (this.isFinished()) return;
      await this.signaling.join();
      this.joined = true;
      this.addEvent('You joined the call');
      this.updateStatus();
    } catch (err) {
      this.teardown();
      this.setStatus({ kind: 'error', message: err instanceof Error ? err.message : String(err) });
    }
  }

  async hangUp(): Promise<void> {
    if (this.isFinished()) return;
    this.sayGoodbye();
    this.addEvent('You left the call');
    this.teardown();
    this.setStatus({ kind: 'ended' });
  }

  sendChat(text: string): boolean {
    const trimmed = text.trim().slice(0, MAX_CHAT_LENGTH);
    if (!trimmed) return false;
    const message: PeerMessage = { type: 'chat', id: randomId(), text: trimmed, sentAt: Date.now() };
    if (!this.broadcast(message)) return false;
    this.handlers.onChat({ id: message.id, from: 'me', name: this.opts.name, text: trimmed, sentAt: message.sentAt });
    this.addTranscript({ kind: 'chat', id: `chat:${message.id}`, speaker: this.opts.name, text: trimmed, at: message.sentAt });
    return true;
  }

  /** Captions are room-wide: everyone transcribes their own mic while the switch is on. */
  setTranscription(on: boolean): void {
    if (on === this.transcription.on || this.isFinished()) return;
    const next = { on, at: Math.max(Date.now(), this.transcription.at + 1), by: this.opts.name };
    this.applyTranscription(next, true);
    this.broadcast({ type: 'transcription', ...next });
  }

  get transcriptionOn(): boolean {
    return this.transcription.on;
  }

  async toggleMic(): Promise<void> {
    if (!this.micTrack) {
      await this.exclusive(async () => {
        this.micTrack = await acquireMicrophone(this.opts.audioDeviceId);
        this.micOn = true;
        await this.replaceOnAll('audio', this.micTrack);
      });
    } else {
      this.micOn = !this.micOn;
      this.micTrack.enabled = this.micOn;
    }
    this.captioner?.setPaused(!this.micOn);
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
      if (!this.screenTrack) await this.replaceOnAll('video', this.cameraTrack);
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
      await this.replaceOnAll('video', track);
    });
    this.applyEncoding();
    this.mediaChanged();
  }

  private async stopScreenShare(): Promise<void> {
    if (!this.screenTrack) return;
    this.screenTrack.stop();
    this.screenTrack = null;
    await this.replaceOnAll('video', this.cameraTrack);
    this.applyEncoding();
    this.mediaChanged();
  }

  private handleRoster(entries: RosterEntry[]): void {
    if (this.isFinished()) return;

    const present = new Set(entries.map((e) => e.id));
    for (const peer of [...this.peers.values()]) {
      if (present.has(peer.id)) peer.seenInRoster = true;
      else if (peer.seenInRoster) this.dropPeer(peer.id);
    }

    const roster = resolveRoster(
      entries.filter((e) => !this.departed.has(e.id)),
      this.selfId,
    );
    // Once in, stay in: a late joiner with a skewed clock must not evict us.
    if (roster.kind === 'full' && !this.admitted) {
      this.teardown();
      this.setStatus({ kind: 'full' });
      return;
    }
    if (roster.kind === 'admitted') {
      this.admitted = true;
      for (const { id } of roster.peers) {
        if (!this.peers.has(id)) this.connectTo(id);
        this.peers.get(id)!.seenInRoster = true;
      }
    }
    this.updateStatus();
  }

  private handleSignal(from: string, payload: SignalPayload): void {
    if (this.isFinished() || this.departed.has(from)) return;
    if (payload.kind === 'bye') {
      if (this.peers.has(from)) this.dropPeer(from);
      else this.departed.add(from);
      return;
    }
    if (payload.kind === 'reset') {
      if (this.peers.has(from)) this.resetPeer(from, false);
      return;
    }
    if (!this.peers.has(from)) {
      if (this.peers.size >= ROOM_CAPACITY - 1) return;
      this.connectTo(from);
      this.updateStatus();
    }
    this.peers.get(from)!.link.handleSignal(payload);
  }

  private connectTo(peerId: string): void {
    this.peers.set(peerId, {
      id: peerId,
      name: '',
      media: null,
      stream: null,
      connection: 'connecting',
      link: this.createLink(peerId),
      everConnected: false,
      seenInRoster: false,
      resets: 0,
      stallTimer: this.watchForStall(peerId),
    });
    this.peakParticipants = Math.max(this.peakParticipants, this.peers.size + 1);
    this.applyEncoding();
    this.emitParticipants();
  }

  private createLink(peerId: string): PeerLink {
    const link: PeerLink = new PeerLink({
      polite: this.selfId < peerId,
      iceServers: this.iceServers,
      localTracks: { audio: this.micTrack, video: this.screenTrack ?? this.cameraTrack },
      sendSignal: (payload) => this.signaling.send(peerId, payload),
      onRemoteStream: (stream) => this.updatePeer(peerId, (p) => (p.stream = stream)),
      onConnectionState: (state) => this.peers.get(peerId)?.link === link && this.handleConnectionState(peerId, state),
      onChannelOpen: () => this.greet(peerId),
      onMessage: (message) => this.handleMessage(peerId, message),
    });
    return link;
  }

  /** Only the offering (impolite) side watches, so the two ends never reset each other in a loop. */
  private watchForStall(peerId: string): number {
    if (this.selfId < peerId) return 0;
    return window.setTimeout(() => {
      const peer = this.peers.get(peerId);
      if (!peer || peer.everConnected || peer.resets >= MAX_RESETS || this.isFinished()) return;
      console.warn(`[call] connection to ${peerId} stalled, starting over`);
      this.resetPeer(peerId, true);
    }, STALL_TIMEOUT_MS);
  }

  /** Replaces the connection to one peer with a fresh one, keeping who they are. */
  private resetPeer(peerId: string, initiate: boolean): void {
    const peer = this.peers.get(peerId);
    if (!peer || this.isFinished()) return;
    window.clearTimeout(peer.stallTimer);
    peer.link.close();
    // The reset goes out before the new offer: sends to a peer are delivered in order.
    if (initiate) this.signaling.send(peerId, { kind: 'reset' });
    peer.resets += 1;
    peer.link = this.createLink(peerId);
    peer.stream = null;
    peer.connection = peer.everConnected ? 'reconnecting' : 'connecting';
    peer.stallTimer = this.watchForStall(peerId);
    this.applyEncoding();
    this.emitParticipants();
    this.updateStatus();
  }

  private dropPeer(peerId: string): void {
    const peer = this.peers.get(peerId);
    if (!peer) return;
    this.departed.add(peerId);
    window.clearTimeout(peer.stallTimer);
    peer.link.close();
    this.peers.delete(peerId);
    if (peer.name) {
      this.handlers.onNotice(`${peer.name} left the call`);
      this.addEvent(`${peer.name} left the call`);
    }
    this.handlers.onCaption({ speakerId: peerId, name: peer.name, text: '', final: true });
    this.applyEncoding();
    this.emitParticipants();
    this.updateStatus();
  }

  private handleConnectionState(peerId: string, state: RTCPeerConnectionState): void {
    if (this.isFinished()) return;
    this.updatePeer(peerId, (peer) => {
      if (state === 'connected') {
        peer.everConnected = true;
        peer.connection = 'connected';
      } else if (state === 'disconnected' || state === 'failed') {
        peer.connection = 'reconnecting';
      } else if (state === 'connecting' || state === 'new') {
        peer.connection = peer.everConnected ? 'reconnecting' : 'connecting';
      }
    });
    this.updateStatus();
  }

  private handleMessage(peerId: string, message: PeerMessage): void {
    const peer = this.peers.get(peerId);
    if (!peer) return;
    switch (message.type) {
      case 'chat': {
        const name = peer.name || 'Guest';
        this.handlers.onChat({ id: message.id, from: 'peer', name, text: message.text, sentAt: message.sentAt });
        this.addTranscript({
          kind: 'chat',
          id: `chat:${peerId}:${message.id}`,
          speaker: name,
          text: message.text,
          at: this.clampRemoteTime(message.sentAt),
        });
        return;
      }
      case 'caption': {
        const name = peer.name || 'Guest';
        this.handlers.onCaption({ speakerId: peerId, name, text: message.text, final: message.final });
        if (message.final && this.transcription.on) {
          this.addTranscript({
            kind: 'speech',
            id: `speech:${peerId}:${message.id}`,
            speaker: name,
            text: message.text,
            at: this.clampRemoteTime(message.at),
          });
        }
        return;
      }
      case 'transcription':
        this.applyTranscription(message, false);
        return;
      case 'state': {
        const firstState = !peer.name;
        this.updatePeer(peerId, (p) => {
          p.name = message.name.trim() || 'Guest';
          p.media = message.media;
        });
        if (firstState) {
          this.handlers.onNotice(`${peer.name} joined the call`);
          this.addEvent(`${peer.name} joined the call`);
        }
      }
    }
  }

  /** Bring a newly connected peer up to date. */
  private greet(peerId: string): void {
    this.sendState(peerId);
    if (this.transcription.at) this.peers.get(peerId)?.link.send({ type: 'transcription', ...this.transcription });
  }

  private applyTranscription(next: { on: boolean; at: number; by: string }, local: boolean): void {
    if (next.at <= this.transcription.at) return;
    const changed = next.on !== this.transcription.on;
    this.transcription = { on: next.on, at: next.at, by: next.by };
    if (changed) {
      const who = local ? 'You' : next.by || 'Someone';
      const text = next.on ? `${who} turned on captions and the transcript` : `${who} turned off captions`;
      this.addEvent(text);
      if (!local) this.handlers.onNotice(text);
      if (next.on && !speechRecognitionSupported()) {
        this.handlers.onNotice('This browser can’t transcribe your voice, but you’ll still see everyone else’s captions.');
      }
    }
    this.syncCaptioner();
    this.handlers.onTranscription({ on: next.on, by: local ? 'You' : next.by, supported: speechRecognitionSupported() });
  }

  private syncCaptioner(): void {
    if (this.transcription.on && !this.isFinished()) {
      if (this.captioner || !speechRecognitionSupported()) return;
      this.captioner = new Captioner({
        onResult: (result) => this.handleOwnCaption(result),
        onError: (message) => this.handlers.onNotice(message),
      });
      this.captioner.setPaused(!this.micOn);
      this.captioner.start();
    } else {
      this.captioner?.stop();
      this.captioner = null;
      this.captionStarts.clear();
      this.handlers.onCaption({ speakerId: 'self', name: this.opts.name, text: '', final: true });
    }
  }

  private handleOwnCaption({ key, text, final }: CaptionResult): void {
    if (this.isFinished()) return;
    const id = `${this.selfId}:${key}`;
    // Stamp an utterance with when it started, so it sorts before chat typed while it was spoken.
    const at = this.captionStarts.get(id) ?? Date.now();
    if (final) this.captionStarts.delete(id);
    else this.captionStarts.set(id, at);

    const clipped = text.slice(0, MAX_CAPTION_LENGTH);
    this.handlers.onCaption({ speakerId: 'self', name: this.opts.name, text: clipped, final });
    this.broadcast({ type: 'caption', id, text: clipped, final, at });
    if (final) this.addTranscript({ kind: 'speech', id: `speech:self:${id}`, speaker: this.opts.name, text: clipped, at });
  }

  private addEvent(text: string): void {
    this.addTranscript({ kind: 'event', id: `event:${randomId()}`, text, at: Date.now() });
  }

  private addTranscript(entry: TranscriptEntry): void {
    this.transcript.add(entry);
    this.handlers.onTranscript(this.transcript.entries);
  }

  private clampRemoteTime(at: number): number {
    const now = Date.now();
    return Math.min(now, Math.max(now - MAX_CLOCK_SKEW_MS, at));
  }

  private updatePeer(peerId: string, change: (peer: PeerState) => void): void {
    const peer = this.peers.get(peerId);
    if (!peer) return;
    change(peer);
    this.emitParticipants();
  }

  /** The room is healthy if anyone is reachable; per-person health is shown on their tile. */
  private updateStatus(): void {
    if (this.isFinished()) return;
    const peers = [...this.peers.values()];
    let kind: CallStatus['kind'];
    if (!peers.length) kind = this.joined ? 'waiting' : 'joining';
    else if (peers.some((p) => p.connection === 'connected')) kind = 'connected';
    else if (peers.some((p) => p.everConnected)) kind = 'reconnecting';
    else kind = 'connecting';
    if (kind !== this.status.kind) this.setStatus({ kind } as CallStatus);
  }

  private emitParticipants(): void {
    this.handlers.onParticipants(
      [...this.peers.values()].map(({ id, name, media, stream, connection }) => ({ id, name, media, stream, connection })),
    );
  }

  private broadcast(message: PeerMessage): boolean {
    let sent = false;
    for (const peer of this.peers.values()) sent = peer.link.send(message) || sent;
    return sent;
  }

  private sendState(peerId?: string): void {
    const message: PeerMessage = { type: 'state', name: this.opts.name, media: this.localMedia };
    if (peerId) this.peers.get(peerId)?.link.send(message);
    else this.broadcast(message);
  }

  private async replaceOnAll(kind: 'audio' | 'video', track: MediaStreamTrack | null): Promise<void> {
    await Promise.all([...this.peers.values()].map((p) => p.link.replaceTrack(kind, track)));
  }

  private applyEncoding(): void {
    const encoding = videoEncodingFor(this.peers.size, !!this.screenTrack);
    for (const peer of this.peers.values()) peer.link.setVideoEncoding(encoding);
  }

  private mediaChanged(): void {
    this.emitLocal();
    this.sendState();
  }

  private emitLocal(): void {
    const video = this.screenTrack ?? this.cameraTrack;
    this.handlers.onLocalMedia({
      preview: new MediaStream(video ? [video] : []),
      mic: this.micOn ? this.micTrack : null,
      media: this.localMedia,
    });
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

  private sayGoodbye(): void {
    for (const id of this.peers.keys()) this.signaling.send(id, { kind: 'bye' });
  }

  private readonly onPageHide = () => this.sayGoodbye();

  private teardown(): void {
    window.removeEventListener('pagehide', this.onPageHide);
    this.captioner?.stop();
    this.captioner = null;
    for (const peer of this.peers.values()) {
      window.clearTimeout(peer.stallTimer);
      peer.link.close();
    }
    this.peers.clear();
    for (const track of [this.micTrack, this.cameraTrack, this.screenTrack]) track?.stop();
    this.micTrack = this.cameraTrack = this.screenTrack = null;
    void this.signaling.leave().catch(() => undefined);
  }
}
