import { createClient, type RealtimeChannel, type SupabaseClient } from '@supabase/supabase-js';
import { roomKey } from './room';
import type { RosterEntry } from './roster';

export type SignalPayload =
  | { kind: 'description'; description: RTCSessionDescriptionInit }
  | { kind: 'candidate'; candidate: RTCIceCandidateInit }
  /** Candidates are batched to keep a full mesh well under Realtime's message rate limits. */
  | { kind: 'candidates'; candidates: RTCIceCandidateInit[] }
  /** Asks the peer to discard its connection to us and start over (sent when negotiation stalls). */
  | { kind: 'reset' }
  | { kind: 'bye' };

interface SignalEnvelope {
  from: string;
  to: string;
  payload: SignalPayload;
}

export interface SignalingHandlers {
  onRoster(entries: RosterEntry[]): void;
  onSignal(from: string, payload: SignalPayload): void;
  onError(message: string): void;
}

export interface Signaling {
  join(): Promise<void>;
  send(to: string, payload: SignalPayload): void;
  leave(): Promise<void>;
}

let sharedClient: SupabaseClient | null = null;

function getClient(url: string, anonKey: string): SupabaseClient {
  sharedClient ??= createClient(url, anonKey, { auth: { persistSession: false } });
  return sharedClient;
}

interface Outbox {
  channel: RealtimeChannel;
  queue: Promise<void>;
}

/**
 * Signaling over Supabase Realtime, with nothing stored in the database.
 *
 * The room channel carries presence only. Each participant also listens on a
 * private inbox channel, and SDP/ICE for them is sent there over Realtime's
 * REST endpoint. Broadcasting signals on the room channel would deliver every
 * message to everyone, which multiplies traffic by the room size and trips the
 * project's rate limits in a full mesh. Sends to each peer are queued so
 * descriptions always arrive before their candidates.
 */
export class SupabaseSignaling implements Signaling {
  private room: RealtimeChannel | null = null;
  private inbox: RealtimeChannel | null = null;
  private readonly outboxes = new Map<string, Outbox>();
  private readonly joinedAt = Date.now();
  private readonly key: string;

  constructor(
    private readonly opts: {
      url: string;
      anonKey: string;
      roomId: string;
      selfId: string;
      handlers: SignalingHandlers;
    },
  ) {
    this.key = encodeURIComponent(roomKey(opts.roomId));
  }

  async join(): Promise<void> {
    const { url, anonKey, selfId, handlers } = this.opts;
    const client = getClient(url, anonKey);

    const inbox = client.channel(this.inboxTopic(selfId), { config: { broadcast: { self: false, ack: false } } });
    this.inbox = inbox;
    inbox.on('broadcast', { event: 'signal' }, ({ payload }) => {
      const envelope = payload as SignalEnvelope;
      if (envelope?.to !== selfId || typeof envelope.from !== 'string' || typeof envelope.payload?.kind !== 'string') return;
      handlers.onSignal(envelope.from, envelope.payload);
    });

    const room = client.channel(`orbit:${this.key}`, { config: { presence: { key: selfId } } });
    this.room = room;
    room.on('presence', { event: 'sync' }, () => {
      const state = room.presenceState<{ joinedAt: number }>();
      const entries: RosterEntry[] = [];
      for (const [id, metas] of Object.entries(state)) {
        const joinedAt = Math.min(...metas.map((m) => m.joinedAt ?? Number.MAX_SAFE_INTEGER));
        entries.push({ id, joinedAt });
      }
      handlers.onRoster(entries);
    });

    // The inbox must be live before our presence makes others start sending to it.
    await this.subscribe(inbox);
    await this.subscribe(room, () => room.track({ joinedAt: this.joinedAt }).then(() => undefined));
  }

  send(to: string, payload: SignalPayload): void {
    if (!this.room || !sharedClient) return;
    let outbox = this.outboxes.get(to);
    if (!outbox) {
      outbox = { channel: sharedClient.channel(this.inboxTopic(to)), queue: Promise.resolve() };
      this.outboxes.set(to, outbox);
    }
    const envelope: SignalEnvelope = { from: this.opts.selfId, to, payload };
    const { channel } = outbox;
    outbox.queue = outbox.queue
      .then(() => channel.httpSend('signal', envelope))
      .then(
        () => undefined,
        (err) => console.warn('[signaling] send failed', err),
      );
  }

  async leave(): Promise<void> {
    const channels = [this.room, this.inbox, ...[...this.outboxes.values()].map((o) => o.channel)];
    const room = this.room;
    this.room = this.inbox = null;
    this.outboxes.clear();
    try {
      await room?.untrack();
    } finally {
      for (const channel of channels) {
        if (!channel) continue;
        await channel.unsubscribe().catch(() => undefined);
        sharedClient?.removeChannel(channel);
      }
    }
  }

  private inboxTopic(id: string): string {
    return `orbit:${this.key}:${id}`;
  }

  private subscribe(channel: RealtimeChannel, onJoined?: () => Promise<void>): Promise<void> {
    const { handlers } = this.opts;
    return new Promise((resolve, reject) => {
      let settled = false;
      channel.subscribe(async (status, err) => {
        if (status === 'SUBSCRIBED') {
          await onJoined?.();
          if (!settled) {
            settled = true;
            resolve();
          }
          return;
        }
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          const message =
            status === 'TIMED_OUT'
              ? 'Timed out connecting to the signaling server.'
              : `Could not connect to the signaling server${err?.message ? `: ${err.message}` : '.'}`;
          if (!settled) {
            settled = true;
            reject(new Error(message));
          } else {
            handlers.onError(message);
          }
        }
      });
    });
  }
}
