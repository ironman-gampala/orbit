const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

function startOfDay(at: number): number {
  const d = new Date(at);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** "Just now", "12 min ago", "Today at 4:30 PM", "Yesterday", "Monday", "Sep 12". */
export function formatWhen(at: number, now: number = Date.now()): string {
  const diff = now - at;
  if (diff < MINUTE) return 'Just now';
  if (diff < HOUR) return `${Math.floor(diff / MINUTE)} min ago`;
  const days = Math.round((startOfDay(now) - startOfDay(at)) / DAY);
  const time = new Date(at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  if (days <= 0) return `Today at ${time}`;
  if (days === 1) return `Yesterday at ${time}`;
  if (days < 7) return new Date(at).toLocaleDateString([], { weekday: 'long' });
  const sameYear = new Date(at).getFullYear() === new Date(now).getFullYear();
  return new Date(at).toLocaleDateString([], { month: 'short', day: 'numeric', year: sameYear ? undefined : 'numeric' });
}

/** "Under a minute", "42 min", "1 hr 5 min". */
export function formatDuration(ms: number): string {
  if (ms < MINUTE) return 'Under a minute';
  const hours = Math.floor(ms / HOUR);
  const minutes = Math.floor((ms % HOUR) / MINUTE);
  if (!hours) return `${minutes} min`;
  return minutes ? `${hours} hr ${minutes} min` : `${hours} hr`;
}

export type DayPart = 'morning' | 'afternoon' | 'evening' | 'night';

export function dayPart(at: number = Date.now()): DayPart {
  const hour = new Date(at).getHours();
  if (hour >= 5 && hour < 12) return 'morning';
  if (hour >= 12 && hour < 17) return 'afternoon';
  if (hour >= 17 && hour < 22) return 'evening';
  return 'night';
}
