import { describe, expect, it } from 'vitest';
import { Transcript, formatTranscript, transcriptFilename } from './transcript';

describe('Transcript', () => {
  it('keeps entries in time order even when they arrive late', () => {
    const t = new Transcript();
    t.add({ kind: 'speech', id: 'a', speaker: 'Asha', text: 'first', at: 1000 });
    t.add({ kind: 'speech', id: 'c', speaker: 'Asha', text: 'third', at: 3000 });
    t.add({ kind: 'chat', id: 'b', speaker: 'Ben', text: 'second', at: 2000 });
    expect(t.entries.map((e) => e.id)).toEqual(['a', 'b', 'c']);
  });

  it('ignores duplicate ids', () => {
    const t = new Transcript();
    t.add({ kind: 'speech', id: 'x', speaker: 'Asha', text: 'hello', at: 1 });
    t.add({ kind: 'speech', id: 'x', speaker: 'Asha', text: 'hello again', at: 2 });
    expect(t.entries).toHaveLength(1);
  });

  it('only counts speech or chat as content', () => {
    const t = new Transcript();
    t.add({ kind: 'event', id: 'e', text: 'Asha joined the call', at: 1 });
    expect(t.hasContent).toBe(false);
    t.add({ kind: 'chat', id: 'c', speaker: 'Asha', text: 'hi', at: 2 });
    expect(t.hasContent).toBe(true);
  });
});

describe('formatTranscript', () => {
  it('renders a readable plain-text transcript', () => {
    const start = new Date(2026, 8, 27, 16, 30, 0).getTime();
    const text = formatTranscript(
      [
        { kind: 'event', id: '1', text: 'Ben joined the call', at: start },
        { kind: 'speech', id: '2', speaker: 'Ben', text: 'Morning all', at: start + 5000 },
        { kind: 'chat', id: '3', speaker: 'Asha', text: 'link incoming', at: start + 9000 },
      ],
      { room: 'Design sync', selfName: 'Asha', startedAt: start },
    );
    expect(text).toContain('Room: Design sync');
    expect(text).toContain('Speakers: Ben, Asha');
    expect(text).toContain('[16:30:00] · Ben joined the call');
    expect(text).toContain('[16:30:05] Ben: Morning all');
    expect(text).toContain('[16:30:09] Asha (chat): link incoming');
  });
});

describe('transcriptFilename', () => {
  it('makes a safe, dated file name', () => {
    const start = new Date(2026, 8, 27, 9, 5).getTime();
    expect(transcriptFilename('Q3: plan/review?', start)).toBe('Orbit transcript - Q3 planreview - 2026-09-27 09.05.txt');
  });
});
