// Two independent browsers join the same room on a deployed Orbit and exercise a full call.
// Usage: npm run e2e            (defaults to https://orbitcall.netlify.app)
//        BASE_URL=http://localhost:8888 npm run e2e
import { BASE, enterLobby, join, launchParticipant, randomRoom, remoteVideosPlaying, waitForStatus } from './browser.mjs';

const room = randomRoom();
const t0 = Date.now();
const log = (...a) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1)}s]`, ...a);
const results = [];

async function step(name, fn) {
  const detail = await fn();
  results.push(name);
  log('PASS', name, detail ?? '');
}

const remoteAudioTracks = (page) => page.$eval('.remote-tile .tile-video', (v) => v.srcObject?.getAudioTracks().length ?? 0);

let alice;
let bob;
let failed = false;
try {
  log('room:', `${BASE}/?room=${room}`);
  alice = await launchParticipant({ onConsoleError: (m) => log('Alice console error:', m) });
  bob = await launchParticipant({ onConsoleError: (m) => log('Bob console error:', m) });

  await step('Alice joins and waits', async () => {
    await enterLobby(alice.page, room, 'Alice');
    await join(alice.page);
    await waitForStatus(alice.page, 'waiting', 20000);
  });

  await step('Bob joins; both sides connect', async () => {
    await enterLobby(bob.page, room, 'Bob');
    await join(bob.page);
    await Promise.all([waitForStatus(alice.page, 'connected'), waitForStatus(bob.page, 'connected')]);
  });

  await step("Alice receives Bob's video", () => remoteVideosPlaying(alice.page, 1));
  await step("Bob receives Alice's video", () => remoteVideosPlaying(bob.page, 1));
  await step('Audio flows both ways', async () => {
    if ((await remoteAudioTracks(alice.page)) !== 1 || (await remoteAudioTracks(bob.page)) !== 1) throw new Error('missing remote audio track');
  });

  await step('Names exchanged over the data channel', async () => {
    await alice.page.waitForFunction(() => document.querySelector('.remote-tile .name-tag-text')?.textContent === 'Bob', { timeout: 10000 });
    await bob.page.waitForFunction(() => document.querySelector('.remote-tile .name-tag-text')?.textContent === 'Alice', { timeout: 10000 });
  });

  await step('Chat message delivered', async () => {
    await bob.page.click('button[aria-label="Chat with everyone"]');
    await bob.page.type('.chat-input', 'Hello from Bob');
    await bob.page.keyboard.press('Enter');
    await alice.page.waitForFunction(() => document.querySelector('.chat-list')?.textContent.includes('Hello from Bob'), { timeout: 10000 });
  });

  await step('Mute is shown to the other side', async () => {
    await alice.page.click('.call-controls .round-btn:nth-child(1)');
    await bob.page.waitForFunction(() => document.querySelector('.remote-tile .badge-muted')?.hidden === false, { timeout: 10000 });
  });

  await step('Camera off shows avatar; camera on restores video', async () => {
    await alice.page.click('.call-controls .round-btn:nth-child(2)');
    await bob.page.waitForSelector('.remote-tile.video-off', { timeout: 10000 });
    await alice.page.click('.call-controls .round-btn:nth-child(2)');
    await bob.page.waitForFunction(() => !document.querySelector('.remote-tile').classList.contains('video-off'), { timeout: 10000 });
  });

  await step('Hang up returns the other side to waiting', async () => {
    await bob.page.click('.round-btn.danger');
    await bob.page.waitForFunction(() => document.body.textContent.includes('You left the call'), { timeout: 10000 });
    await waitForStatus(alice.page, 'waiting', 15000);
  });
} catch (err) {
  failed = true;
  log('FAIL', err.message);
} finally {
  await alice?.browser.close().catch(() => {});
  await bob?.browser.close().catch(() => {});
  log(`${results.length} steps passed${failed ? ', 1 failed' : ''}`);
  process.exit(failed ? 1 : 0);
}
