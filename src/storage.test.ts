import { describe, expect, it } from 'vitest';
import { MAX_RECENT_ROOMS, MAX_SAVED_TRANSCRIPTS, OrbitStore } from './storage';

function memoryStorage(limit = Infinity) {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => {
      const size = [...data].reduce((n, [key, val]) => n + (key === k ? 0 : val.length), 0) + v.length;
      if (size > limit) throw new DOMException('full', 'QuotaExceededError');
      data.set(k, v);
    },
    removeItem: (k: string) => void data.delete(k),
  };
}

function setup(limit?: number) {
  let clock = 1_000;
  const storage = memoryStorage(limit);
  const store = new OrbitStore(storage, () => (clock += 1000));
  return { store, storage };
}

describe('OrbitStore recent rooms', () => {
  it('lists rooms newest first and counts visits case-insensitively', () => {
    const { store } = setup();
    store.recordVisit('Design sync');
    store.recordVisit('4021');
    store.recordVisit('design SYNC');
    const rooms = store.recentRooms();
    expect(rooms.map((r) => r.name)).toEqual(['design SYNC', '4021']);
    expect(rooms[0].visits).toBe(2);
  });

  it('keeps only the most recent rooms', () => {
    const { store } = setup();
    for (let i = 0; i < MAX_RECENT_ROOMS + 5; i++) store.recordVisit(`room ${i}`);
    const rooms = store.recentRooms();
    expect(rooms).toHaveLength(MAX_RECENT_ROOMS);
    expect(rooms[0].name).toBe(`room ${MAX_RECENT_ROOMS + 4}`);
  });

  it('records how a call went and keeps its transcript', () => {
    const { store } = setup();
    store.recordVisit('Standup');
    store.recordCallEnd('Standup', { durationMs: 90_000, people: 4, transcript: { filename: 'a.txt', text: 'hello' } });
    const [room] = store.recentRooms();
    expect(room).toMatchObject({ lastDurationMs: 90_000, lastPeople: 4 });
    expect(store.getTranscript(room.transcriptId!)).toMatchObject({ filename: 'a.txt', text: 'hello', room: 'Standup' });
  });

  it('forgets a removed room along with its transcript', () => {
    const { store } = setup();
    store.recordVisit('Standup');
    store.recordCallEnd('Standup', { durationMs: 1, people: 2, transcript: { filename: 'a.txt', text: 'x' } });
    const id = store.recentRooms()[0].transcriptId!;
    store.removeRoom('STANDUP');
    expect(store.recentRooms()).toEqual([]);
    expect(store.getTranscript(id)).toBeNull();
  });

  it('caps saved transcripts', () => {
    const { store } = setup();
    for (let i = 0; i < MAX_SAVED_TRANSCRIPTS + 3; i++) {
      store.recordVisit(`r${i}`);
      store.recordCallEnd(`r${i}`, { durationMs: 1, people: 2, transcript: { filename: 'f.txt', text: 't' } });
    }
    const withTranscript = store.recentRooms().filter((r) => r.transcriptId && store.getTranscript(r.transcriptId));
    expect(withTranscript).toHaveLength(MAX_SAVED_TRANSCRIPTS);
  });

  it('survives corrupt data and full storage', () => {
    const { store, storage } = setup(400);
    storage.data.set('orbit:recent-rooms', '{not json');
    expect(store.recentRooms()).toEqual([]);
    storage.data.set('orbit:recent-rooms', JSON.stringify([{ name: 'ok', lastJoinedAt: 5 }, { bad: true }, 'nope']));
    expect(store.recentRooms().map((r) => r.name)).toEqual(['ok']);

    store.recordVisit('ok');
    expect(() =>
      store.recordCallEnd('ok', { durationMs: 1, people: 2, transcript: { filename: 'f.txt', text: 'x'.repeat(10_000) } }),
    ).not.toThrow();
    expect(store.recentRooms()[0].transcriptId).toBeUndefined();
  });

  it('works without any storage at all', () => {
    const store = new OrbitStore(null);
    store.recordVisit('x');
    store.setName('Asha');
    expect(store.recentRooms()).toEqual([]);
    expect(store.getName()).toBe('');
  });
});

describe('OrbitStore preferences', () => {
  it('remembers name and devices', () => {
    const { store } = setup();
    store.setName('  Asha Rao  ');
    store.setDevicePrefs({ audioDeviceId: 'mic-1', camOn: false });
    expect(store.getName()).toBe('Asha Rao');
    expect(store.getDevicePrefs()).toEqual({ audioDeviceId: 'mic-1', videoDeviceId: undefined, micOn: undefined, camOn: false });
  });
});
