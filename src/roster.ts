export interface RosterEntry {
  id: string;
  joinedAt: number;
}

export interface RosterPeer {
  id: string;
  polite: boolean;
}

export type RosterStatus =
  /** Our own presence hasn't been echoed back yet. */
  | { kind: 'pending' }
  | { kind: 'admitted'; peers: RosterPeer[] }
  | { kind: 'full' };

/** Everyone connects to everyone (mesh), so each person uploads to ROOM_CAPACITY - 1 peers. */
export const ROOM_CAPACITY = 10;

/**
 * Decides who is in the call from the room's presence list. The first
 * ROOM_CAPACITY participants to join (ties broken by id) own the room; anyone
 * after is turned away. Politeness for perfect negotiation is derived from id
 * ordering so both sides of every pair reach the same answer independently.
 */
export function resolveRoster(entries: RosterEntry[], selfId: string): RosterStatus {
  const unique = new Map<string, RosterEntry>();
  for (const entry of entries) {
    const existing = unique.get(entry.id);
    if (!existing || entry.joinedAt < existing.joinedAt) unique.set(entry.id, entry);
  }

  const ordered = [...unique.values()].sort((a, b) => a.joinedAt - b.joinedAt || a.id.localeCompare(b.id));
  const admitted = ordered.slice(0, ROOM_CAPACITY);

  if (!admitted.some((e) => e.id === selfId)) {
    return unique.has(selfId) ? { kind: 'full' } : { kind: 'pending' };
  }

  return {
    kind: 'admitted',
    peers: admitted.filter((e) => e.id !== selfId).map((e) => ({ id: e.id, polite: selfId < e.id })),
  };
}
