export type TranscriptEntry =
  | { kind: 'speech'; id: string; speaker: string; text: string; at: number }
  | { kind: 'chat'; id: string; speaker: string; text: string; at: number }
  | { kind: 'event'; id: string; text: string; at: number };

export interface TranscriptMeta {
  room: string;
  selfName: string;
  startedAt: number;
}

/** Ordered, de-duplicated record of what was said, typed and what happened in a call. */
export class Transcript {
  private readonly byId = new Map<string, TranscriptEntry>();
  private list: TranscriptEntry[] = [];

  get entries(): readonly TranscriptEntry[] {
    return this.list;
  }

  /** Worth offering as a download: someone spoke or typed, not just came and went. */
  get hasContent(): boolean {
    return this.list.some((e) => e.kind !== 'event');
  }

  add(entry: TranscriptEntry): void {
    if (this.byId.has(entry.id)) return;
    this.byId.set(entry.id, entry);
    // Entries almost always arrive in order, so scan from the end.
    let index = this.list.length;
    while (index > 0 && this.list[index - 1].at > entry.at) index--;
    this.list.splice(index, 0, entry);
  }
}

function clockTime(at: number): string {
  return new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
}

export function formatTranscript(entries: readonly TranscriptEntry[], meta: TranscriptMeta): string {
  const speakers = new Set<string>();
  for (const entry of entries) if (entry.kind !== 'event') speakers.add(entry.speaker);

  const header = [
    'Orbit transcript',
    `Room: ${meta.room}`,
    `Date: ${new Date(meta.startedAt).toLocaleString([], { dateStyle: 'full', timeStyle: 'short' })}`,
    `Your name: ${meta.selfName}`,
  ];
  if (speakers.size) header.push(`Speakers: ${[...speakers].join(', ')}`);

  const lines = entries.map((entry) => {
    const time = `[${clockTime(entry.at)}]`;
    if (entry.kind === 'event') return `${time} · ${entry.text}`;
    if (entry.kind === 'chat') return `${time} ${entry.speaker} (chat): ${entry.text}`;
    return `${time} ${entry.speaker}: ${entry.text}`;
  });

  return `${header.join('\n')}\n\n${lines.join('\n')}\n`;
}

export function transcriptFilename(room: string, startedAt: number): string {
  const d = new Date(startedAt);
  const pad = (n: number) => String(n).padStart(2, '0');
  const stamp = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}.${pad(d.getMinutes())}`;
  const safeRoom = room.replace(/[\\/:*?"<>|\p{Cc}]/gu, '').trim().slice(0, 60) || 'room';
  return `Orbit transcript - ${safeRoom} - ${stamp}.txt`;
}

export function downloadText(filename: string, text: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
