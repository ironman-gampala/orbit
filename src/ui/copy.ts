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
  lead:
    'Open a room, share the link and start talking. Orbit brings up to ten people together with crisp video, live captions and a transcript you can keep. No downloads, no accounts, nothing to install.',
  newRoom: 'Start a room',
  joinPlaceholder: 'Enter a room name, number or link',
  join: 'Join',
  hintLead: 'Call your room anything you like. Try',
  hintJoiner: 'or',
  suggestions: ['Design sync', '4021'],
  privacy: 'Anyone with the room name can join. Start a room to get a private code nobody can guess.',
  recentTitle: 'Jump back in',
  recentEmpty: 'Your rooms will live here. Join one and it will be a single click away next time.',
  clear: 'Clear',
  clearConfirm: 'Tap again to clear',
  cleared: 'Recent rooms cleared from this device',
  features: [
    {
      icon: 'people',
      title: 'Room for the whole team',
      body: 'Bring up to ten people together. Everyone gets a seat in the grid and screen shares take center stage.',
    },
    {
      icon: 'captions',
      title: 'Every word, captured',
      body: 'Switch on live captions for the whole room and walk away with a transcript you can download.',
    },
    {
      icon: 'lock',
      title: 'Private by design',
      body: 'Calls are encrypted from browser to browser, and Orbit never records or stores them.',
    },
    {
      icon: 'history',
      title: 'Remembers what matters',
      body: 'Your name, your camera and mic, and your recent rooms stay on this device, ready for next time.',
    },
  ] satisfies { icon: IconName; title: string; body: string }[],
} as const;
