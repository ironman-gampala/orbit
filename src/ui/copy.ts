import type { DayPart } from '../time';
import type { IconName } from './dom';

/**
 * Home page copy. House style: warm product marketing voice, and no
 * semicolons, hyphens or dashes anywhere (copy.test.ts enforces it).
 */
export const HOME_COPY = {
  greetings: {
    morning: 'Good morning',
    afternoon: 'Good afternoon',
    evening: 'Good evening',
    night: 'Up late',
  } satisfies Record<DayPart, string>,
  welcomeBack: 'Welcome back.',
  welcomeNew: 'Welcome to Orbit.',
  headline: 'Face to face, from anywhere.',
  lead: 'Share a link and start talking. No accounts, no downloads, nothing to install.',
  newRoom: 'Start a room',
  joinPlaceholder: 'Room name or link',
  join: 'Join',
  privacy: 'Anyone with the name can join. Start a room for a private code.',
  recentTitle: 'Jump back in',
  recentEmpty: 'Your rooms will live here. Join one and it will be a single click away next time.',
  clear: 'Clear',
  clearConfirm: 'Tap again to clear',
  cleared: 'Recent rooms cleared from this device',
  features: [
    {
      icon: 'people',
      title: 'Room for the whole team',
      body: 'Up to ten people in one room, with screen shares front and center.',
    },
    {
      icon: 'captions',
      title: 'Every word, captured',
      body: 'Live captions for everyone and a transcript to download.',
    },
    {
      icon: 'lock',
      title: 'Private by design',
      body: 'Encrypted browser to browser. Never recorded or stored.',
    },
  ] satisfies { icon: IconName; title: string; body: string }[],
} as const;
