// Several independent browsers join a named room and form a full mesh.
// Usage: npm run e2e:group                 (4 people on https://orbitcall.netlify.app)
//        PEOPLE=6 BASE_URL=http://localhost:5173 npm run e2e:group
import { mkdtempSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join as joinPath } from 'node:path';
import { allPeersConnected, enterLobby, join, launchChrome, launchParticipant, remoteNames, remoteVideosPlaying, sleep, waitForStatus } from './browser.mjs';

const SPEECH = { Ben: ['Morning everyone', 'Let us ship the release today'] };
const downloads = mkdtempSync(joinPath(tmpdir(), 'orbit-e2e-'));

const NAMES = ['Asha', 'Ben', 'Chen', 'Dana', 'Eli', 'Fatima', 'Gus', 'Hana', 'Ivan', 'Jo'];
const count = Math.min(NAMES.length, Number(process.env.PEOPLE ?? 4));
/** CAMERA=off joins everyone with video off, which a single machine can sustain for a full room. */
const cameras = process.env.CAMERA !== 'off';
const room = `Team sync ${Math.random().toString(36).slice(2, 6)}`;
const t0 = Date.now();
const log = (...a) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1)}s]`, ...a);
const results = [];

async function step(name, fn) {
  const detail = await fn();
  results.push(name);
  log('PASS', name, detail ?? '');
}

// One Chrome with an isolated context per person: ten separate Chromes swamp a laptop.
const chrome = await launchChrome();
const people = [];
let failed = false;
try {
  log(`room: "${room}" with ${count} people${cameras ? '' : ', cameras off'}`);
  for (let i = 0; i < count; i++) {
    const name = NAMES[i];
    const participant = await launchParticipant({
      shared: chrome,
      onConsoleError: (m) => log(`${name} console:`, m),
      fakeSpeech: SPEECH[name] ?? [],
      downloadPath: i === 0 ? downloads : undefined,
    });
    if (!cameras) await participant.page.evaluateOnNewDocument(() => localStorage.setItem('orbit:devices', JSON.stringify({ camOn: false })));
    people.push({ name, ...participant });
  }

  await step('Everyone joins a room with a free-form name', async () => {
    for (const person of people) {
      await enterLobby(person.page, room, person.name);
      await join(person.page);
      await sleep(400);
    }
    await Promise.all(people.map((p) => waitForStatus(p.page, 'connected', 60000)));
  });

  await step('Everyone is connected to everyone else', async () => {
    await Promise.all(people.map((p) => allPeersConnected(p.page, count - 1)));
    if (cameras) return (await Promise.all(people.map((p) => remoteVideosPlaying(p.page, count - 1, 45000))))[0];
  });

  await step('Everyone sees the right names and headcount', async () => {
    await Promise.all(
      people.map(async (person) => {
        const expected = people.filter((p) => p !== person).map((p) => p.name).sort();
        await person.page.waitForFunction(
          (names) => JSON.stringify([...document.querySelectorAll('.remote-tile .name-tag-text')].map((e) => e.textContent).sort()) === JSON.stringify(names),
          { timeout: 15000 },
          expected,
        );
        const shown = await person.page.$eval('.people-count-value', (e) => e.textContent);
        if (shown !== String(count)) throw new Error(`${person.name} shows ${shown} people`);
      }),
    );
    return (await remoteNames(people[0].page)).join(', ');
  });

  await step('Grid layout is used for three or more people', async () => {
    const layouts = await Promise.all(people.map((p) => p.page.$eval('main.call', (m) => m.dataset.layout)));
    if (count >= 3 && layouts.some((l) => l !== 'grid')) throw new Error(`layouts: ${layouts.join(', ')}`);
    return layouts[0];
  });

  await step('Chat reaches everyone', async () => {
    const sender = people[1];
    await sender.page.click('button[aria-label="Chat with everyone"]');
    await sender.page.type('.chat-input', 'Hello team');
    await sender.page.keyboard.press('Enter');
    await Promise.all(
      people
        .filter((p) => p !== sender)
        .map((p) => p.page.waitForFunction(() => document.querySelector('.chat-list')?.textContent.includes('Hello team'), { timeout: 10000 })),
    );
  });

  if (count === NAMES.length) {
    await step(`An ${count + 1}th person is turned away from a full room`, async () => {
      const extra = await launchParticipant({ shared: chrome });
      try {
        await enterLobby(extra.page, room, 'Kai');
        await join(extra.page);
        await extra.page.waitForFunction(() => document.body.textContent.includes('This room is full'), { timeout: 20000 });
      } finally {
        await extra.browser.close();
      }
      await sleep(1500);
      const counts = await Promise.all(people.map((p) => p.page.$eval('.people-count-value', (e) => e.textContent)));
      if (counts.some((c) => c !== String(count))) throw new Error(`headcounts after rejection: ${counts.join(', ')}`);
    });
  }

  await step('Turning on captions switches them on for the whole room', async () => {
    await people[0].page.click('button[aria-label="Turn on captions and transcript"]');
    await Promise.all(people.map((p) => p.page.waitForSelector('.live-pill:not([hidden])', { timeout: 10000 })));
  });

  await step("Ben's speech shows up as a live caption for everyone", async () => {
    const listeners = people.filter((p) => p.name !== 'Ben');
    const outcomes = await Promise.allSettled(
      listeners.map((p) =>
        p.page.waitForFunction(
          (phrases) => [...document.querySelectorAll('.caption-line')].some((l) => l.textContent.startsWith('Ben') && phrases.some((s) => l.textContent.includes(s))),
          { timeout: 15000 },
          SPEECH.Ben,
        ),
      ),
    );
    const missed = listeners.filter((_, i) => outcomes[i].status === 'rejected');
    if (missed.length) {
      const seen = await missed[0].page.$$eval('.caption-line', (ls) => ls.map((l) => l.textContent));
      throw new Error(`${missed.map((p) => p.name).join(', ')} missed the caption; ${missed[0].name} saw ${JSON.stringify(seen)}`);
    }
  });

  await step('Transcript collects speech and chat, and downloads as text', async () => {
    const asha = people[0].page;
    await asha.click('button[aria-label="Open transcript"]');
    await asha.waitForFunction(() => document.querySelector('.transcript-list')?.textContent.includes('Let us ship the release today'), { timeout: 15000 });
    await asha.click('.transcript-actions .btn-primary');
    let file;
    for (let i = 0; i < 50 && !file; i++) {
      await sleep(100);
      file = readdirSync(downloads).find((f) => f.endsWith('.txt'));
    }
    if (!file) throw new Error('no transcript downloaded');
    const text = readFileSync(joinPath(downloads, file), 'utf8');
    for (const expected of [`Room: ${room}`, 'Ben: Morning everyone', 'Ben: Let us ship the release today', 'Ben (chat): Hello team', 'turned on captions']) {
      if (!text.includes(expected)) throw new Error(`transcript is missing "${expected}"\n${text}`);
    }
    return file;
  });

  await step('Someone leaves and the rest stay connected', async () => {
    const leaver = people.pop();
    await leaver.page.click('.round-btn.danger');
    await leaver.page.waitForFunction(() => [...document.querySelectorAll('button')].some((b) => b.textContent === 'Download transcript'), { timeout: 10000 });
    const home = await leaver.page.$$eval('button', (bs) => bs.findIndex((b) => b.textContent === 'Return to home screen'));
    await (await leaver.page.$$('button'))[home].click();
    await leaver.page.waitForFunction(
      (name) => {
        const item = [...document.querySelectorAll('.recent')].find((li) => li.querySelector('strong')?.textContent === name);
        return item && item.querySelector('[aria-label^="Download transcript"]');
      },
      { timeout: 10000 },
      room,
    );
    await leaver.browser.close();
    await Promise.all(people.map((p) => (cameras ? remoteVideosPlaying(p.page, people.length - 1, 20000) : allPeersConnected(p.page, people.length - 1, 20000))));
    await Promise.all(people.map((p) => waitForStatus(p.page, people.length > 1 ? 'connected' : 'waiting', 10000)));
  });
} catch (err) {
  failed = true;
  log('FAIL', err.message);
} finally {
  await Promise.all(people.map((p) => p.browser.close().catch(() => {})));
  await chrome.close().catch(() => {});
  log(`${results.length} steps passed${failed ? ', 1 failed' : ''}`);
  process.exit(failed ? 1 : 0);
}
