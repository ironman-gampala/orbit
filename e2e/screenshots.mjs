// Regenerates docs/screenshots from a live deployment.
// Usage: npm run screenshots
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { BASE, enterLobby, join, launchParticipant, randomRoom, sleep, waitForStatus } from './browser.mjs';

const OUT = fileURLToPath(new URL('../docs/screenshots/', import.meta.url));
mkdirSync(OUT, { recursive: true });
const room = randomRoom();

const shot = async (page, name) => {
  await sleep(600);
  await page.screenshot({ path: `${OUT}${name}.png` });
  console.log('saved', name);
};

const alice = await launchParticipant({ viewport: { width: 1280, height: 800, deviceScaleFactor: 2 } });
const bob = await launchParticipant({ viewport: { width: 390, height: 844, deviceScaleFactor: 3, isMobile: true, hasTouch: true } });

try {
  await alice.page.goto(BASE, { waitUntil: 'networkidle2' });
  await shot(alice.page, '01-landing');

  await enterLobby(alice.page, room, 'Alice');
  await sleep(1500);
  await shot(alice.page, '02-lobby');

  await join(alice.page);
  await waitForStatus(alice.page, 'waiting', 20000);
  await shot(alice.page, '03-waiting');

  await enterLobby(bob.page, room, 'Bob');
  await join(bob.page);
  await Promise.all([waitForStatus(alice.page, 'connected'), waitForStatus(bob.page, 'connected')]);
  await alice.page.waitForFunction(() => document.querySelector('.stage .name-tag-text')?.textContent === 'Bob', { timeout: 10000 });
  await sleep(3500);
  await shot(alice.page, '04-in-call');
  await shot(bob.page, '08-mobile-call');

  await bob.page.click('button[aria-label="Chat with everyone"]');
  await bob.page.type('.chat-input', 'Hey Alice! Can you see my screen share next?');
  await bob.page.keyboard.press('Enter');
  await alice.page.click('button[aria-label="Chat with everyone"]');
  await alice.page.waitForFunction(() => document.querySelector('.chat-list')?.textContent.includes('Hey Alice'), { timeout: 10000 });
  await alice.page.type('.chat-input', 'Yep, loud and clear. Go ahead.');
  await alice.page.keyboard.press('Enter');
  await bob.page.waitForFunction(() => document.querySelector('.chat-list')?.textContent.includes('loud and clear'), { timeout: 10000 });
  await shot(alice.page, '05-chat');
  await alice.page.click('button[aria-label="Close chat"]');
  await bob.page.click('button[aria-label="Close chat"]');

  await bob.page.click('.call-controls .round-btn:nth-child(1)');
  await bob.page.click('.call-controls .round-btn:nth-child(2)');
  await alice.page.waitForSelector('.stage.video-off', { timeout: 10000 });
  await alice.page.waitForFunction(() => document.querySelector('.stage .badge-muted')?.hidden === false, { timeout: 10000 });
  await shot(alice.page, '06-remote-camera-off');

  await alice.page.click('.round-btn.danger');
  await alice.page.waitForFunction(() => document.body.textContent.includes('You left the call'), { timeout: 10000 });
  await shot(alice.page, '07-left-call');
} finally {
  await alice.browser.close().catch(() => {});
  await bob.browser.close().catch(() => {});
  process.exit(0);
}
