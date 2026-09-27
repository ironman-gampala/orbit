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

/**
 * Stand-in for the browser speech service (unavailable in headless Chrome):
 * once captions start, it "hears" each phrase as an interim then final result.
 */
function installFakeSpeech(phrases) {
  class FakeRecognition {
    constructor() {
      this.onresult = null;
      this.results = [];
    }
    start() {
      let i = 0;
      this.timer = setInterval(() => {
        if (i >= phrases.length) return clearInterval(this.timer);
        const text = phrases[i++];
        const words = text.split(' ');
        const emit = (transcript, isFinal) => {
          const index = this.results.length - (this.results.at(-1)?.isFinal === false ? 1 : 0);
          this.results[index] = Object.assign([{ transcript }], { isFinal });
          this.onresult?.({ resultIndex: index, results: this.results });
        };
        emit(words.slice(0, Math.ceil(words.length / 2)).join(' '), false);
        setTimeout(() => emit(text, true), 300);
      }, 900);
    }
    stop() {
      this.abort();
    }
    abort() {
      clearInterval(this.timer);
      setTimeout(() => this.onend?.(), 0);
    }
  }
  window.SpeechRecognition = FakeRecognition;
  window.webkitSpeechRecognition = FakeRecognition;
}

/** Separate Chrome instance per participant, with Chrome's synthetic camera + mic. */
export async function launchParticipant({ viewport = { width: 1280, height: 800 }, onConsoleError, fakeSpeech, downloadPath } = {}) {
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
  if (fakeSpeech) await page.evaluateOnNewDocument(installFakeSpeech, fakeSpeech);
  if (downloadPath) {
    const cdp = await page.createCDPSession();
    await cdp.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath });
  }
  if (onConsoleError) {
    page.on('console', (m) => m.type() === 'error' && onConsoleError(m.text()));
    page.on('pageerror', (e) => onConsoleError(e.message));
  }
  return { browser, page };
}

export async function enterLobby(page, room, name) {
  await page.goto(`${BASE}/?${new URLSearchParams({ room })}`, { waitUntil: 'networkidle2' });
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

/** Resolves once `count` remote tiles are each playing video, returning their resolutions. */
export const remoteVideosPlaying = (page, count, timeout = 30000) =>
  page
    .waitForFunction(
      (n) => {
        const videos = [...document.querySelectorAll('.remote-tile .tile-video')];
        return videos.length === n && videos.every((v) => v.videoWidth > 0 && !v.paused);
      },
      { timeout },
      count,
    )
    .then(() => page.$$eval('.remote-tile .tile-video', (vs) => vs.map((v) => `${v.videoWidth}x${v.videoHeight}`).join(', ')));

export const remoteNames = (page) =>
  page.$$eval('.remote-tile .name-tag-text', (els) => els.map((e) => e.textContent).sort());
