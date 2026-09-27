import { decodeMessage, encodeMessage, type PeerMessage } from './messages';
import type { SignalPayload } from './signaling';

type Kind = 'audio' | 'video';

export interface PeerLinkOptions {
  polite: boolean;
  iceServers: RTCIceServer[];
  localTracks: { audio: MediaStreamTrack | null; video: MediaStreamTrack | null };
  sendSignal(payload: SignalPayload): void;
  onRemoteStream(stream: MediaStream): void;
  onConnectionState(state: RTCPeerConnectionState): void;
  onChannelOpen(): void;
  onMessage(message: PeerMessage): void;
}

/**
 * One RTCPeerConnection to the remote peer, using the "perfect negotiation"
 * pattern so either side can (re)negotiate without glare.
 *
 * Only the impolite peer creates transceivers and the data channel, which keeps
 * the SDP to exactly one audio + one video m-line. The polite peer attaches its
 * tracks to the transceivers created by the incoming offer. All later media
 * changes (mute, camera off, screen share) use replaceTrack, so they never
 * require renegotiation.
 */
export class PeerLink {
  private readonly pc: RTCPeerConnection;
  private channel: RTCDataChannel | null = null;
  private readonly desired: Record<Kind, MediaStreamTrack | null>;
  private readonly remoteTracks: Partial<Record<Kind, MediaStreamTrack>> = {};
  private makingOffer = false;
  private ignoreOffer = false;
  private queue: Promise<void> = Promise.resolve();
  private closed = false;

  constructor(private readonly opts: PeerLinkOptions) {
    this.desired = { ...opts.localTracks };
    this.pc = new RTCPeerConnection({ iceServers: opts.iceServers });
    const pc = this.pc;

    pc.onnegotiationneeded = async () => {
      try {
        this.makingOffer = true;
        await pc.setLocalDescription();
        if (pc.localDescription) this.opts.sendSignal({ kind: 'description', description: pc.localDescription.toJSON() });
      } catch (err) {
        console.error('[peer] negotiation failed', err);
      } finally {
        this.makingOffer = false;
      }
    };

    pc.onicecandidate = ({ candidate }) => {
      if (candidate) this.opts.sendSignal({ kind: 'candidate', candidate: candidate.toJSON() });
    };

    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'failed') pc.restartIce();
      this.opts.onConnectionState(pc.connectionState);
    };

    pc.ontrack = ({ track }) => {
      const kind = track.kind as Kind;
      const adopt = () => {
        if (this.remoteTracks[kind] === track) return;
        this.remoteTracks[kind] = track;
        this.emitRemoteStream();
      };
      if (!track.muted) adopt();
      track.addEventListener('unmute', adopt);
    };

    pc.ondatachannel = ({ channel }) => this.attachChannel(channel);

    if (!opts.polite) {
      pc.addTransceiver(this.desired.audio ?? 'audio', { direction: 'sendrecv' });
      pc.addTransceiver(this.desired.video ?? 'video', { direction: 'sendrecv' });
      this.attachChannel(pc.createDataChannel('meets', { ordered: true }));
    }
  }

  handleSignal(payload: SignalPayload): void {
    this.queue = this.queue.then(() => this.processSignal(payload)).catch((err) => {
      console.error('[peer] failed to handle signal', err);
    });
  }

  async replaceTrack(kind: Kind, track: MediaStreamTrack | null): Promise<void> {
    this.desired[kind] = track;
    const transceiver = this.transceiverFor(kind);
    if (transceiver) await transceiver.sender.replaceTrack(track);
  }

  send(message: PeerMessage): boolean {
    if (this.channel?.readyState !== 'open') return false;
    this.channel.send(encodeMessage(message));
    return true;
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.channel?.close();
    this.pc.close();
  }

  private async processSignal(payload: SignalPayload): Promise<void> {
    if (this.closed) return;
    const pc = this.pc;

    if (payload.kind === 'description') {
      const { description } = payload;
      const offerCollision = description.type === 'offer' && (this.makingOffer || pc.signalingState !== 'stable');
      this.ignoreOffer = !this.opts.polite && offerCollision;
      if (this.ignoreOffer) return;

      await pc.setRemoteDescription(description);
      if (description.type === 'offer') {
        await this.attachLocalTracks();
        await pc.setLocalDescription();
        if (pc.localDescription) this.opts.sendSignal({ kind: 'description', description: pc.localDescription.toJSON() });
      }
      return;
    }

    if (payload.kind === 'candidate') {
      try {
        await pc.addIceCandidate(payload.candidate);
      } catch (err) {
        if (!this.ignoreOffer) throw err;
      }
    }
  }

  /** Polite side: bind local tracks to the transceivers the remote offer created. */
  private async attachLocalTracks(): Promise<void> {
    for (const kind of ['audio', 'video'] as const) {
      const transceiver = this.transceiverFor(kind);
      if (!transceiver) continue;
      if (transceiver.direction !== 'sendrecv') transceiver.direction = 'sendrecv';
      if (transceiver.sender.track !== this.desired[kind]) await transceiver.sender.replaceTrack(this.desired[kind]);
    }
  }

  private transceiverFor(kind: Kind): RTCRtpTransceiver | undefined {
    return this.pc.getTransceivers().find((t) => t.receiver.track.kind === kind && t.direction !== 'stopped');
  }

  private attachChannel(channel: RTCDataChannel): void {
    this.channel = channel;
    channel.onopen = () => this.opts.onChannelOpen();
    channel.onmessage = ({ data }) => {
      const message = decodeMessage(data);
      if (message) this.opts.onMessage(message);
    };
  }

  private emitRemoteStream(): void {
    const tracks = [this.remoteTracks.audio, this.remoteTracks.video].filter((t): t is MediaStreamTrack => !!t);
    this.opts.onRemoteStream(new MediaStream(tracks));
  }
}
