export interface RosterEntry {
  id: string;
  joinedAt: number;
}

export type RosterStatus =
  | { kind: 'waiting' }
  | { kind: 'paired'; peerId: string; polite: boolean }
  | { kind: 'full' };

export const ROOM_CAPACITY = 2;

/**
 * Decides who is in the call from the room's presence list. The first two
 * participants to join (ties broken by id) own the room; anyone after is turned away.
 * Politeness for perfect negotiation is derived from id ordering so both
 * sides reach the same answer independently.
 */
export function resolveRoster(entries: RosterEntry[], selfId: string): RosterStatus {
  const unique = new Map<string, RosterEntry>();
  for (const entry of entries) {
    const existing = unique.get(entry.id);
    if (!existing || entry.joinedAt < existing.joinedAt) unique.set(entry.id, entry);
  }

  const ordered = [...unique.values()].sort(
    (a, b) => a.joinedAt - b.joinedAt || a.id.localeCompare(b.id),
  );
  const admitted = ordered.slice(0, ROOM_CAPACITY);

  if (!admitted.some((e) => e.id === selfId)) {
    // Our own presence may not have been echoed back yet.
    return unique.has(selfId) ? { kind: 'full' } : { kind: 'waiting' };
  }

  const peer = admitted.find((e) => e.id !== selfId);
  if (!peer) return { kind: 'waiting' };
  return { kind: 'paired', peerId: peer.id, polite: selfId < peer.id };
}
