interface RecognitionAlternative {
  transcript: string;
}
interface RecognitionResult {
  readonly isFinal: boolean;
  readonly length: number;
  [index: number]: RecognitionAlternative;
}
interface RecognitionEvent {
  readonly resultIndex: number;
  readonly results: { readonly length: number; [index: number]: RecognitionResult };
}
interface Recognition {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((event: RecognitionEvent) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}
type RecognitionCtor = new () => Recognition;

function recognitionCtor(): RecognitionCtor | null {
  const w = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export function speechRecognitionSupported(): boolean {
  return !!recognitionCtor();
}

export interface CaptionResult {
  /** Stable for one utterance, so interim updates can be replaced by the final text. */
  key: string;
  text: string;
  final: boolean;
}

/**
 * Live captions for the local microphone using the browser's speech service
 * (Chrome, Edge and Safari). Recognition sessions end on their own after
 * silence or a network hiccup, so this restarts them with backoff for as long
 * as captions are on and the mic is unmuted.
 */
export class Captioner {
  private recognition: Recognition | null = null;
  private active = false;
  private paused = false;
  private session = 0;
  private startedAt = 0;
  private backoff = 250;
  private restartTimer = 0;

  constructor(
    private readonly opts: {
      lang?: string;
      onResult(result: CaptionResult): void;
      onError(message: string): void;
    },
  ) {}

  start(): void {
    this.active = true;
    this.run();
  }

  stop(): void {
    this.active = false;
    this.halt();
  }

  setPaused(paused: boolean): void {
    this.paused = paused;
    if (paused) this.halt();
    else this.run();
  }

  private run(): void {
    if (!this.active || this.paused || this.recognition) return;
    const Ctor = recognitionCtor();
    if (!Ctor) return;

    const recognition = new Ctor();
    const session = ++this.session;
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = this.opts.lang ?? navigator.language ?? 'en-US';

    recognition.onresult = (event) => {
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        const text = result[0]?.transcript.trim();
        if (text) this.opts.onResult({ key: `${session}-${i}`, text, final: result.isFinal });
      }
    };
    recognition.onerror = ({ error }) => {
      if (error === 'not-allowed' || error === 'service-not-allowed') {
        this.active = false;
        this.opts.onError('Captions need microphone access and a browser speech service. Your voice won’t be transcribed.');
      } else if (error === 'language-not-supported') {
        this.active = false;
        this.opts.onError('Your browser can’t transcribe this language.');
      }
    };
    recognition.onend = () => {
      if (this.recognition !== recognition) return;
      this.recognition = null;
      if (!this.active || this.paused) return;
      // Sessions that die immediately mean the service is struggling; back off.
      this.backoff = Date.now() - this.startedAt < 2000 ? Math.min(this.backoff * 2, 8000) : 250;
      this.restartTimer = window.setTimeout(() => this.run(), this.backoff);
    };

    this.recognition = recognition;
    this.startedAt = Date.now();
    try {
      recognition.start();
    } catch {
      this.recognition = null;
    }
  }

  private halt(): void {
    window.clearTimeout(this.restartTimer);
    const recognition = this.recognition;
    this.recognition = null;
    recognition?.abort();
  }
}
