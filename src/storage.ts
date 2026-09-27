import { MAX_NAME_LENGTH } from './messages';
import { MAX_ROOM_NAME_LENGTH, roomKey } from './room';

export interface RecentRoom {
  name: string;
  firstJoinedAt: number;
  lastJoinedAt: number;
  visits: number;
  /** Length of the most recent call, once it has ended. */
  lastDurationMs?: number;
  /** Most people in the room at once during the most recent call. */
  lastPeople?: number;
  /** Saved transcript of the most recent call that had one. */
  transcriptId?: string;
}

export interface SavedTranscript {
  id: string;
  room: string;
  filename: string;
  text: string;
  savedAt: number;
}

export interface DevicePrefs {
  audioDeviceId?: string;
  videoDeviceId?: string;
  micOn?: boolean;
  camOn?: boolean;
}

export interface CallRecord {
  durationMs: number;
  people: number;
  transcript?: { filename: string; text: string } | null;
}

type KeyValueStore = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

const KEYS = {
  name: 'orbit:name',
  rooms: 'orbit:recent-rooms',
  devices: 'orbit:devices',
  transcripts: 'orbit:transcripts',
} as const;

export const MAX_RECENT_ROOMS = 12;
export const MAX_SAVED_TRANSCRIPTS = 10;
const MAX_TRANSCRIPT_CHARS = 200_000;

function browserStorage(): KeyValueStore | null {
  try {
    const storage = window.localStorage;
    const probe = '__orbit_probe__';
    storage.setItem(probe, '1');
    storage.removeItem(probe);
    return storage;
  } catch {
    return null; // private mode, disabled storage or no window
  }
}

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isStr = (v: unknown): v is string => typeof v === 'string';

function parseRoom(v: unknown): RecentRoom | null {
  if (typeof v !== 'object' || v === null) return null;
  const r = v as Record<string, unknown>;
  if (!isStr(r.name) || !r.name.trim() || !isNum(r.lastJoinedAt)) return null;
  return {
    name: r.name.slice(0, MAX_ROOM_NAME_LENGTH),
    firstJoinedAt: isNum(r.firstJoinedAt) ? r.firstJoinedAt : r.lastJoinedAt,
    lastJoinedAt: r.lastJoinedAt,
    visits: isNum(r.visits) && r.visits > 0 ? Math.floor(r.visits) : 1,
    lastDurationMs: isNum(r.lastDurationMs) ? r.lastDurationMs : undefined,
    lastPeople: isNum(r.lastPeople) ? r.lastPeople : undefined,
    transcriptId: isStr(r.transcriptId) ? r.transcriptId : undefined,
  };
}

function parseTranscript(v: unknown): SavedTranscript | null {
  if (typeof v !== 'object' || v === null) return null;
  const t = v as Record<string, unknown>;
  if (!isStr(t.id) || !isStr(t.room) || !isStr(t.filename) || !isStr(t.text) || !isNum(t.savedAt)) return null;
  return { id: t.id, room: t.room, filename: t.filename, text: t.text, savedAt: t.savedAt };
}

/**
 * Everything Orbit remembers lives in this browser's localStorage: your name,
 * devices, recent rooms and transcripts. Nothing is synced anywhere. Reads
 * tolerate corrupt data and writes tolerate full or disabled storage.
 */
export class OrbitStore {
  constructor(
    private readonly storage: KeyValueStore | null = browserStorage(),
    private readonly now: () => number = Date.now,
  ) {}

  getName(): string {
    return (this.storage?.getItem(KEYS.name) ?? '').slice(0, MAX_NAME_LENGTH);
  }

  setName(name: string): void {
    this.write(KEYS.name, name.trim().slice(0, MAX_NAME_LENGTH), true);
  }

  getDevicePrefs(): DevicePrefs {
    const raw = this.readJson(KEYS.devices);
    if (typeof raw !== 'object' || raw === null) return {};
    const p = raw as Record<string, unknown>;
    return {
      audioDeviceId: isStr(p.audioDeviceId) ? p.audioDeviceId : undefined,
      videoDeviceId: isStr(p.videoDeviceId) ? p.videoDeviceId : undefined,
      micOn: typeof p.micOn === 'boolean' ? p.micOn : undefined,
      camOn: typeof p.camOn === 'boolean' ? p.camOn : undefined,
    };
  }

  setDevicePrefs(prefs: DevicePrefs): void {
    this.write(KEYS.devices, JSON.stringify(prefs));
  }

  recentRooms(): RecentRoom[] {
    const raw = this.readJson(KEYS.rooms);
    if (!Array.isArray(raw)) return [];
    const seen = new Set<string>();
    const rooms: RecentRoom[] = [];
    for (const item of raw) {
      const room = parseRoom(item);
      if (!room || seen.has(roomKey(room.name))) continue;
      seen.add(roomKey(room.name));
      rooms.push(room);
    }
    return rooms.sort((a, b) => b.lastJoinedAt - a.lastJoinedAt).slice(0, MAX_RECENT_ROOMS);
  }

  /** Called when joining: moves the room to the top of the list. */
  recordVisit(name: string): void {
    const at = this.now();
    const rooms = this.recentRooms();
    const existing = this.find(rooms, name);
    const room: RecentRoom = existing
      ? { ...existing, name, lastJoinedAt: at, visits: existing.visits + 1 }
      : { name, firstJoinedAt: at, lastJoinedAt: at, visits: 1 };
    this.saveRooms([room, ...rooms.filter((r) => r !== existing)]);
  }

  /** Called when a call ends: remembers how it went and keeps its transcript. */
  recordCallEnd(name: string, record: CallRecord): void {
    const rooms = this.recentRooms();
    const room = this.find(rooms, name);
    if (!room) return;
    room.lastDurationMs = Math.max(0, record.durationMs);
    room.lastPeople = Math.max(1, record.people);
    if (record.transcript) {
      const id = `${roomKey(name)}:${this.now()}`;
      if (this.saveTranscript({ id, room: name, ...record.transcript, savedAt: this.now() })) room.transcriptId = id;
    }
    this.saveRooms(rooms);
  }

  removeRoom(name: string): void {
    this.saveRooms(this.recentRooms().filter((r) => roomKey(r.name) !== roomKey(name)));
  }

  clearRooms(): void {
    this.storage?.removeItem(KEYS.rooms);
    this.storage?.removeItem(KEYS.transcripts);
  }

  getTranscript(id: string): SavedTranscript | null {
    return this.transcripts().find((t) => t.id === id) ?? null;
  }

  private transcripts(): SavedTranscript[] {
    const raw = this.readJson(KEYS.transcripts);
    return Array.isArray(raw) ? raw.map(parseTranscript).filter((t): t is SavedTranscript => !!t) : [];
  }

  private saveTranscript(transcript: SavedTranscript): boolean {
    const clipped = { ...transcript, text: transcript.text.slice(0, MAX_TRANSCRIPT_CHARS) };
    let list = [clipped, ...this.transcripts()].slice(0, MAX_SAVED_TRANSCRIPTS);
    // When storage is full, give up the oldest transcripts first.
    while (list.length) {
      if (this.write(KEYS.transcripts, JSON.stringify(list))) return list[0] === clipped;
      list = list.slice(0, -1);
    }
    return false;
  }

  private saveRooms(rooms: RecentRoom[]): void {
    const kept = rooms.slice(0, MAX_RECENT_ROOMS);
    this.write(KEYS.rooms, JSON.stringify(kept));
    // Drop transcripts whose room fell off the list or was removed.
    const referenced = new Set(kept.map((r) => r.transcriptId).filter(Boolean));
    const transcripts = this.transcripts();
    const live = transcripts.filter((t) => referenced.has(t.id));
    if (live.length !== transcripts.length) this.write(KEYS.transcripts, JSON.stringify(live));
  }

  private find(rooms: RecentRoom[], name: string): RecentRoom | undefined {
    const key = roomKey(name);
    return rooms.find((r) => roomKey(r.name) === key);
  }

  private readJson(key: string): unknown {
    try {
      const raw = this.storage?.getItem(key);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }

  private write(key: string, value: string, removeIfEmpty = false): boolean {
    if (!this.storage) return false;
    try {
      if (removeIfEmpty && !value) this.storage.removeItem(key);
      else this.storage.setItem(key, value);
      return true;
    } catch {
      return false;
    }
  }
}

export const store = new OrbitStore();
