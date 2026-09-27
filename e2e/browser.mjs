import puppeteer from 'puppeteer-core';

export const BASE = process.env.BASE_URL ?? 'https://orbitcall.netlify.app';

const CHROME =
  process.env.CHROME_PATH ??
  {
    darwin: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    linux: '/usr/bin/google-chrome',
    win32: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  }[process.platform];

const ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';
const pick = (n) => Array.from({ length: n }, () => ALPHABET[Math.floor(Math.random() * ALPHABET.length)]).join('');

export const randomRoom = () => `${pick(3)}-${pick(4)}-${pick(3)}`;
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Separate Chrome instance per participant, with Chrome's synthetic camera + mic. */
export async function launchParticipant({ viewport = { width: 1280, height: 800 }, onConsoleError } = {}) {
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: true,
    args: [
      '--use-fake-ui-for-media-stream',
      '--use-fake-device-for-media-stream',
      '--autoplay-policy=no-user-gesture-required',
      '--no-first-run',
    ],
    defaultViewport: viewport,
  });
  const page = await browser.newPage();
  if (onConsoleError) {
    page.on('console', (m) => m.type() === 'error' && onConsoleError(m.text()));
    page.on('pageerror', (e) => onConsoleError(e.message));
  }
  return { browser, page };
}

export async function enterLobby(page, room, name) {
  await page.goto(`${BASE}/?room=${room}`, { waitUntil: 'networkidle2' });
  await page.waitForSelector('.lobby-panel button[type=submit]:not([disabled])', { timeout: 20000 });
  await page.$eval('.lobby-panel input[type=text]', (el) => (el.value = ''));
  await page.type('.lobby-panel input[type=text]', name);
}

export async function join(page) {
  await page.click('.lobby-panel button[type=submit]');
  await page.waitForSelector('main.call', { timeout: 10000 });
}

export const waitForStatus = (page, status, timeout = 40000) =>
  page.waitForSelector(`main.call[data-status="${status}"]`, { timeout });
