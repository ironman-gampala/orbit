// Several independent browsers join a named room and form a full mesh.
// Usage: npm run e2e:group                 (4 people on https://orbitcall.netlify.app)
//        PEOPLE=6 BASE_URL=http://localhost:5173 npm run e2e:group
import { BASE, enterLobby, join, launchParticipant, remoteNames, remoteVideosPlaying, sleep, waitForStatus } from './browser.mjs';

const NAMES = ['Asha', 'Ben', 'Chen', 'Dana', 'Eli', 'Fatima', 'Gus', 'Hana', 'Ivan', 'Jo'];
const count = Math.min(NAMES.length, Number(process.env.PEOPLE ?? 4));
const room = `Team sync ${Math.random().toString(36).slice(2, 6)}`;
const t0 = Date.now();
const log = (...a) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1)}s]`, ...a);
const results = [];

async function step(name, fn) {
  const detail = await fn();
  results.push(name);
  log('PASS', name, detail ?? '');
}

const people = [];
let failed = false;
try {
  log(`room: "${room}" with ${count} people`);
  for (let i = 0; i < count; i++) {
    people.push({ name: NAMES[i], ...(await launchParticipant({ onConsoleError: (m) => log(`${NAMES[i]} console error:`, m) })) });
  }

  await step('Everyone joins a room with a free-form name', async () => {
    for (const person of people) {
      await enterLobby(person.page, room, person.name);
      await join(person.page);
      await sleep(400);
    }
    await Promise.all(people.map((p) => waitForStatus(p.page, 'connected')));
  });

  await step('Everyone receives video from everyone else', async () => {
    const sizes = await Promise.all(people.map((p) => remoteVideosPlaying(p.page, count - 1, 45000)));
    return sizes[0];
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

  await step('Someone leaves and the rest stay connected', async () => {
    const leaver = people.pop();
    await leaver.page.click('.round-btn.danger');
    await leaver.browser.close();
    await Promise.all(people.map((p) => remoteVideosPlaying(p.page, people.length - 1, 20000)));
    await Promise.all(people.map((p) => waitForStatus(p.page, people.length > 1 ? 'connected' : 'waiting', 10000)));
  });
} catch (err) {
  failed = true;
  log('FAIL', err.message);
} finally {
  await Promise.all(people.map((p) => p.browser.close().catch(() => {})));
  log(`${results.length} steps passed${failed ? ', 1 failed' : ''}`);
  process.exit(failed ? 1 : 0);
}
