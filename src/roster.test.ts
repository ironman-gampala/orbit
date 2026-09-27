import { describe, expect, it } from 'vitest';
import { ROOM_CAPACITY, resolveRoster } from './roster';

const people = (count: number) =>
  Array.from({ length: count }, (_, i) => ({ id: `p${String(i).padStart(2, '0')}`, joinedAt: i + 1 }));

describe('resolveRoster', () => {
  it('admits a lone participant with no peers', () => {
    expect(resolveRoster([{ id: 'a', joinedAt: 1 }], 'a')).toEqual({ kind: 'admitted', peers: [] });
  });

  it('is pending when our own presence has not synced yet', () => {
    expect(resolveRoster([{ id: 'b', joinedAt: 1 }], 'a')).toEqual({ kind: 'pending' });
  });

  it('pairs two participants with complementary politeness', () => {
    const entries = [
      { id: 'a', joinedAt: 1 },
      { id: 'b', joinedAt: 2 },
    ];
    expect(resolveRoster(entries, 'a')).toEqual({ kind: 'admitted', peers: [{ id: 'b', polite: true }] });
    expect(resolveRoster(entries, 'b')).toEqual({ kind: 'admitted', peers: [{ id: 'a', polite: false }] });
  });

  it('connects everyone to everyone up to the room capacity', () => {
    const entries = people(ROOM_CAPACITY);
    for (const self of entries) {
      const status = resolveRoster(entries, self.id);
      expect(status.kind).toBe('admitted');
      if (status.kind !== 'admitted') continue;
      expect(status.peers.map((p) => p.id)).toEqual(entries.filter((e) => e !== self).map((e) => e.id));
    }
  });

  it('gives every pair exactly one polite side', () => {
    const entries = people(5);
    for (const a of entries) {
      for (const b of entries) {
        if (a === b) continue;
        const fromA = resolveRoster(entries, a.id);
        const fromB = resolveRoster(entries, b.id);
        if (fromA.kind !== 'admitted' || fromB.kind !== 'admitted') throw new Error('expected admitted');
        const aPolite = fromA.peers.find((p) => p.id === b.id)!.polite;
        const bPolite = fromB.peers.find((p) => p.id === a.id)!.polite;
        expect(aPolite).not.toBe(bPolite);
      }
    }
  });

  it('turns away anyone past capacity by join order', () => {
    const entries = people(ROOM_CAPACITY + 1).reverse();
    const late = entries[0];
    expect(resolveRoster(entries, late.id)).toEqual({ kind: 'full' });
    const first = resolveRoster(entries, entries[entries.length - 1].id);
    expect(first.kind === 'admitted' && first.peers.some((p) => p.id === late.id)).toBe(false);
  });

  it('breaks join-time ties deterministically by id', () => {
    const entries = people(ROOM_CAPACITY + 1).map((e) => ({ ...e, joinedAt: 5 }));
    const last = [...entries].sort((a, b) => b.id.localeCompare(a.id))[0];
    expect(resolveRoster(entries, last.id)).toEqual({ kind: 'full' });
  });

  it('dedupes repeated entries for the same participant', () => {
    const entries = [
      { id: 'a', joinedAt: 1 },
      { id: 'a', joinedAt: 4 },
      { id: 'b', joinedAt: 2 },
    ];
    expect(resolveRoster(entries, 'b')).toEqual({ kind: 'admitted', peers: [{ id: 'a', polite: false }] });
  });
});
