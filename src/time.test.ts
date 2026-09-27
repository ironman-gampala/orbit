import { describe, expect, it } from 'vitest';
import { dayPart, formatDuration, formatWhen } from './time';

const at = (d: number, h: number, m = 0) => new Date(2026, 8, d, h, m).getTime();

describe('formatWhen', () => {
  const now = at(27, 16, 30);

  it('describes recent moments in minutes', () => {
    expect(formatWhen(now - 20_000, now)).toBe('Just now');
    expect(formatWhen(now - 12 * 60_000, now)).toBe('12 min ago');
  });

  it('uses today, yesterday and weekday for the past week', () => {
    expect(formatWhen(at(27, 9, 5), now)).toMatch(/^Today at 9:05/);
    expect(formatWhen(at(26, 22, 0), now)).toMatch(/^Yesterday at/);
    expect(formatWhen(at(23, 10, 0), now)).toBe(new Date(at(23, 10)).toLocaleDateString([], { weekday: 'long' }));
  });

  it('falls back to a date for older visits', () => {
    expect(formatWhen(at(2, 10, 0), now)).toBe(new Date(at(2, 10)).toLocaleDateString([], { month: 'short', day: 'numeric' }));
  });
});

describe('formatDuration', () => {
  it('rounds to friendly units', () => {
    expect(formatDuration(30_000)).toBe('Under a minute');
    expect(formatDuration(42 * 60_000 + 10_000)).toBe('42 min');
    expect(formatDuration(65 * 60_000)).toBe('1 hr 5 min');
    expect(formatDuration(120 * 60_000)).toBe('2 hr');
  });
});

describe('dayPart', () => {
  it('buckets the hour of day', () => {
    expect(dayPart(at(27, 7))).toBe('morning');
    expect(dayPart(at(27, 13))).toBe('afternoon');
    expect(dayPart(at(27, 19))).toBe('evening');
    expect(dayPart(at(27, 2))).toBe('night');
  });
});
