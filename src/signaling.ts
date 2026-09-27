import { createClient, type RealtimeChannel, type SupabaseClient } from '@supabase/supabase-js';
import { roomKey } from './room';
import type { RosterEntry } from './roster';

export type SignalPayload =
  | { kind: 'description'; description: RTCSessionDescriptionInit }
  | { kind: 'candidate'; candidate: RTCIceCandidateInit }
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

/**
 * Signaling over a Supabase Realtime channel per room: presence tracks who is
 * in the room, broadcast carries SDP/ICE addressed to a specific peer.
 * Nothing is persisted in the database.
 */
export class SupabaseSignaling implements Signaling {
  private channel: RealtimeChannel | null = null;
  private readonly joinedAt = Date.now();

  constructor(
    private readonly opts: {
      url: string;
      anonKey: string;
      roomId: string;
      selfId: string;
      handlers: SignalingHandlers;
    },
  ) {}

  join(): Promise<void> {
    const { url, anonKey, roomId, selfId, handlers } = this.opts;
    const client = getClient(url, anonKey);

    const channel = client.channel(`orbit:${encodeURIComponent(roomKey(roomId))}`, {
      config: { broadcast: { self: false, ack: false }, presence: { key: selfId } },
    });
    this.channel = channel;

    channel
      .on('broadcast', { event: 'signal' }, ({ payload }) => {
        const envelope = payload as SignalEnvelope;
        if (envelope?.to !== selfId || typeof envelope.from !== 'string') return;
        handlers.onSignal(envelope.from, envelope.payload);
      })
      .on('presence', { event: 'sync' }, () => {
        const state = channel.presenceState<{ joinedAt: number }>();
        const entries: RosterEntry[] = [];
        for (const [id, metas] of Object.entries(state)) {
          const joinedAt = Math.min(...metas.map((m) => m.joinedAt ?? Number.MAX_SAFE_INTEGER));
          entries.push({ id, joinedAt });
        }
        handlers.onRoster(entries);
      });

    return new Promise((resolve, reject) => {
      let settled = false;
      channel.subscribe(async (status, err) => {
        if (status === 'SUBSCRIBED') {
          await channel.track({ joinedAt: this.joinedAt });
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

  send(to: string, payload: SignalPayload): void {
    if (!this.channel) return;
    const envelope: SignalEnvelope = { from: this.opts.selfId, to, payload };
    void this.channel.send({ type: 'broadcast', event: 'signal', payload: envelope });
  }

  async leave(): Promise<void> {
    const channel = this.channel;
    this.channel = null;
    if (!channel) return;
    try {
      await channel.untrack();
    } finally {
      await channel.unsubscribe();
      sharedClient?.removeChannel(channel);
    }
  }
}
