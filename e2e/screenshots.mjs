// Regenerates docs/screenshots from a live deployment with a four-person call.
// Usage: npm run screenshots            (BASE_URL defaults to https://orbitcall.netlify.app)
import { mkdirSync, readdirSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { BASE, enterLobby, join, launchParticipant, remoteVideosPlaying, sleep, waitForStatus } from './browser.mjs';

const OUT = fileURLToPath(new URL('../docs/screenshots/', import.meta.url));
mkdirSync(OUT, { recursive: true });
for (const file of readdirSync(OUT)) if (file.endsWith('.png')) rmSync(`${OUT}${file}`);

const room = 'Launch review';
const desktop = { width: 1280, height: 800, deviceScaleFactor: 2 };
const mobile = { width: 390, height: 844, deviceScaleFactor: 3, isMobile: true, hasTouch: true };

const shot = async (page, name, opts = {}) => {
  await sleep(600);
  await page.screenshot({ path: `${OUT}${name}.png`, ...opts });
  console.log('saved', name);
};

const now = Date.now();
const seededRooms = [
  { name: 'Design sync', firstJoinedAt: now - 9e8, lastJoinedAt: now - 25 * 60e3, visits: 6, lastDurationMs: 42 * 60e3, lastPeople: 5, transcriptId: 'seed' },
  { name: '4021', firstJoinedAt: now - 9e7, lastJoinedAt: now - 26 * 3600e3, visits: 2, lastDurationMs: 18 * 60e3, lastPeople: 2 },
  { name: 'Friday retro', firstJoinedAt: now - 5e8, lastJoinedAt: now - 3 * 86400e3, visits: 3, lastDurationMs: 65 * 60e3, lastPeople: 8 },
];
const seededTranscripts = [{ id: 'seed', room: 'Design sync', filename: 'Design sync.txt', text: 'Orbit transcript', savedAt: now }];

async function seedHome(page, name) {
  await page.goto(BASE, { waitUntil: 'networkidle2' });
  await page.evaluate(
    (rooms, transcripts, n) => {
      localStorage.setItem('orbit:recent-rooms', JSON.stringify(rooms));
      localStorage.setItem('orbit:transcripts', JSON.stringify(transcripts));
      localStorage.setItem('orbit:name', n);
    },
    seededRooms,
    seededTranscripts,
    name,
  );
  await page.reload({ waitUntil: 'networkidle2' });
}

const cast = [
  { name: 'Asha Rao', viewport: desktop, speech: ['Love it. I will share the notes right after this.'] },
  { name: 'Ben Carter', viewport: { width: 1280, height: 800 }, speech: ['Morning everyone, the new build is live.', 'Let us walk through the release checklist.'] },
  { name: 'Chen Li', viewport: { width: 1280, height: 800 }, speech: [] },
  { name: 'Dana Kim', viewport: mobile, speech: [] },
];
const people = [];

try {
  for (const person of cast) {
    people.push({ ...person, ...(await launchParticipant({ viewport: person.viewport, fakeSpeech: person.speech })) });
  }
  const [asha, ben, chen, dana] = people;

  await seedHome(asha.page, asha.name);
  await shot(asha.page, '01-home');
  await seedHome(dana.page, dana.name);
  await shot(dana.page, '02-home-mobile', { fullPage: true });

  await enterLobby(asha.page, room, asha.name);
  await sleep(1500);
  await shot(asha.page, '03-lobby');

  await join(asha.page);
  await waitForStatus(asha.page, 'waiting', 20000);
  await shot(asha.page, '04-waiting');

  for (const person of [ben, chen, dana]) {
    await enterLobby(person.page, room, person.name);
    await join(person.page);
    await sleep(400);
  }
  await Promise.all(people.map((p) => waitForStatus(p.page, 'connected')));
  await remoteVideosPlaying(asha.page, 3, 45000);
  await remoteVideosPlaying(dana.page, 3, 45000);
  await sleep(4500); // let the join toasts fade
  await shot(asha.page, '05-group-call');
  await shot(dana.page, '06-mobile-call');

  await asha.page.click('button[aria-label="Turn on captions and transcript"]');
  await asha.page.waitForFunction(() => document.querySelectorAll('.caption-line').length >= 2, { timeout: 15000 });
  await shot(asha.page, '07-live-captions');

  await ben.page.click('button[aria-label="Chat with everyone"]');
  await ben.page.type('.chat-input', 'Checklist is in the doc. Shout if anything is missing!');
  await ben.page.keyboard.press('Enter');
  await asha.page.waitForFunction(() => document.querySelector('.transcript-list')?.textContent.includes('release checklist'), { timeout: 15000 });
  await sleep(4500);
  await asha.page.click('button[aria-label="Open transcript"]');
  await shot(asha.page, '08-transcript');

  await asha.page.click('.tabs .tab:first-child');
  await asha.page.type('.chat-input', 'Looks complete to me. Shipping it.');
  await asha.page.keyboard.press('Enter');
  await shot(asha.page, '09-chat');

  await asha.page.click('.round-btn.danger');
  await asha.page.waitForFunction(() => document.body.textContent.includes('Download transcript'), { timeout: 10000 });
  await shot(asha.page, '10-left-call');
} finally {
  await Promise.all(people.map((p) => p.browser.close().catch(() => {})));
  process.exit(0);
}
