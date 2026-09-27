import { describe, expect, it } from 'vitest';
import { resolveRoster } from './roster';

describe('resolveRoster', () => {
  it('waits when alone', () => {
    expect(resolveRoster([{ id: 'a', joinedAt: 1 }], 'a')).toEqual({ kind: 'waiting' });
  });

  it('waits when our own presence has not synced yet', () => {
    expect(resolveRoster([{ id: 'b', joinedAt: 1 }], 'a')).toEqual({ kind: 'waiting' });
  });

  it('pairs two participants with complementary politeness', () => {
    const entries = [
      { id: 'a', joinedAt: 1 },
      { id: 'b', joinedAt: 2 },
    ];
    expect(resolveRoster(entries, 'a')).toEqual({ kind: 'paired', peerId: 'b', polite: true });
    expect(resolveRoster(entries, 'b')).toEqual({ kind: 'paired', peerId: 'a', polite: false });
  });

  it('turns away the third participant by join order', () => {
    const entries = [
      { id: 'c', joinedAt: 3 },
      { id: 'a', joinedAt: 1 },
      { id: 'b', joinedAt: 2 },
    ];
    expect(resolveRoster(entries, 'c')).toEqual({ kind: 'full' });
    expect(resolveRoster(entries, 'a')).toMatchObject({ kind: 'paired', peerId: 'b' });
    expect(resolveRoster(entries, 'b')).toMatchObject({ kind: 'paired', peerId: 'a' });
  });

  it('breaks join-time ties deterministically by id', () => {
    const entries = [
      { id: 'z', joinedAt: 5 },
      { id: 'y', joinedAt: 5 },
      { id: 'x', joinedAt: 5 },
    ];
    expect(resolveRoster(entries, 'z')).toEqual({ kind: 'full' });
    expect(resolveRoster(entries, 'x')).toMatchObject({ kind: 'paired', peerId: 'y' });
  });

  it('dedupes repeated entries for the same participant', () => {
    const entries = [
      { id: 'a', joinedAt: 1 },
      { id: 'a', joinedAt: 4 },
      { id: 'b', joinedAt: 2 },
    ];
    expect(resolveRoster(entries, 'b')).toMatchObject({ kind: 'paired', peerId: 'a' });
  });
});
