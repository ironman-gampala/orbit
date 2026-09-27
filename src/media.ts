export interface DeviceLists {
  audioInputs: MediaDeviceInfo[];
  videoInputs: MediaDeviceInfo[];
}

export interface MediaRequest {
  audio: boolean;
  video: boolean;
  audioDeviceId?: string;
  videoDeviceId?: string;
  /** Treat the device ids as preferences (e.g. remembered from last time) rather than requirements. */
  preferDevices?: boolean;
}

export interface AcquiredMedia {
  stream: MediaStream;
  /** Set when some requested media could not be obtained. */
  warning?: string;
}

export async function listDevices(): Promise<DeviceLists> {
  const devices = await navigator.mediaDevices.enumerateDevices();
  return {
    audioInputs: devices.filter((d) => d.kind === 'audioinput' && d.deviceId),
    videoInputs: devices.filter((d) => d.kind === 'videoinput' && d.deviceId),
  };
}

function deviceConstraint(deviceId: string | undefined, exact: boolean): ConstrainDOMString | undefined {
  if (!deviceId) return undefined;
  return exact ? { exact: deviceId } : { ideal: deviceId };
}

export function audioConstraints(deviceId?: string, exact = true): MediaTrackConstraints {
  return {
    deviceId: deviceConstraint(deviceId, exact),
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: true,
  };
}

export function videoConstraints(deviceId?: string, exact = true): MediaTrackConstraints {
  return {
    deviceId: deviceConstraint(deviceId, exact),
    width: { ideal: 1280 },
    height: { ideal: 720 },
    frameRate: { ideal: 30 },
  };
}

export function describeMediaError(err: unknown): string {
  const name = err instanceof DOMException ? err.name : '';
  switch (name) {
    case 'NotAllowedError':
    case 'SecurityError':
      return 'Permission to use the camera/microphone was denied. Allow access in your browser’s site settings.';
    case 'NotFoundError':
    case 'OverconstrainedError':
      return 'No matching camera or microphone was found.';
    case 'NotReadableError':
    case 'AbortError':
      return 'The camera or microphone is in use by another app.';
    default:
      return err instanceof Error ? err.message : 'Could not access camera/microphone.';
  }
}

/**
 * Requests camera and mic together, falling back to whichever one works so a
 * missing webcam doesn't also cost the user their microphone.
 */
export async function acquireMedia(req: MediaRequest): Promise<AcquiredMedia> {
  if (!navigator.mediaDevices?.getUserMedia) {
    return {
      stream: new MediaStream(),
      warning: 'This browser cannot access media devices. Use a recent browser over HTTPS or localhost.',
    };
  }
  if (!req.audio && !req.video) return { stream: new MediaStream() };

  const exact = !req.preferDevices;
  const audio = req.audio ? audioConstraints(req.audioDeviceId, exact) : false;
  const video = req.video ? videoConstraints(req.videoDeviceId, exact) : false;

  let firstError: unknown;
  try {
    return { stream: await navigator.mediaDevices.getUserMedia({ audio, video }) };
  } catch (err) {
    if (!(audio && video)) return { stream: new MediaStream(), warning: describeMediaError(err) };
    firstError = err;
  }

  for (const [constraints, missing] of [
    [{ audio, video: false }, 'camera'],
    [{ audio: false, video }, 'microphone'],
  ] as const) {
    try {
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      return { stream, warning: `Could not access your ${missing}. Continuing without it.` };
    } catch {
      // Try the next option.
    }
  }

  return { stream: new MediaStream(), warning: describeMediaError(firstError) };
}

export async function acquireCamera(deviceId?: string): Promise<MediaStreamTrack> {
  const stream = await navigator.mediaDevices.getUserMedia({ video: videoConstraints(deviceId) });
  return stream.getVideoTracks()[0];
}

export async function acquireMicrophone(deviceId?: string): Promise<MediaStreamTrack> {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: audioConstraints(deviceId) });
  return stream.getAudioTracks()[0];
}

export function canShareScreen(): boolean {
  return typeof navigator.mediaDevices?.getDisplayMedia === 'function';
}

export async function acquireScreen(): Promise<MediaStreamTrack> {
  const stream = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: { ideal: 15 } }, audio: false });
  const track = stream.getVideoTracks()[0];
  track.contentHint = 'detail';
  return track;
}

export function stopStream(stream: MediaStream | null | undefined): void {
  stream?.getTracks().forEach((t) => t.stop());
}

/** Calls `onLevel` with a 0..1 loudness value every animation frame until stopped. */
export function createLevelMeter(track: MediaStreamTrack, onLevel: (level: number) => void): () => void {
  const AudioCtx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  const ctx = new AudioCtx();
  const source = ctx.createMediaStreamSource(new MediaStream([track]));
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 512;
  source.connect(analyser);
  const data = new Uint8Array(analyser.fftSize);

  let frame = 0;
  const tick = () => {
    analyser.getByteTimeDomainData(data);
    let sum = 0;
    for (const v of data) {
      const centered = (v - 128) / 128;
      sum += centered * centered;
    }
    onLevel(Math.min(1, Math.sqrt(sum / data.length) * 4));
    frame = requestAnimationFrame(tick);
  };
  tick();

  return () => {
    cancelAnimationFrame(frame);
    source.disconnect();
    void ctx.close();
  };
}
