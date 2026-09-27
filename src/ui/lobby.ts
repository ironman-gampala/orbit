import { acquireCamera, acquireMedia, acquireMicrophone, createLevelMeter, describeMediaError, listDevices, stopStream } from '../media';
import { MAX_NAME_LENGTH } from '../messages';
import { roomUrl } from '../room';
import { attachStream, copyText, h, icon, initials, navigate, showToast, type Cleanup } from './dom';
import { renderBrand } from './landing';

export interface LobbyResult {
  name: string;
  stream: MediaStream;
  micOn: boolean;
  audioDeviceId?: string;
  videoDeviceId?: string;
}

const NAME_KEY = 'meets:name';

export function mountLobby(
  container: HTMLElement,
  opts: { roomId: string; onJoin(result: LobbyResult): void },
): Cleanup {
  let stream = new MediaStream();
  let micOn = true;
  let camOn = true;
  let audioDeviceId: string | undefined;
  let videoDeviceId: string | undefined;
  let stopMeter: (() => void) | null = null;
  let handedOff = false;
  let disposed = false;
  let busy = false;

  const video = h('video', { class: 'tile-video mirrored', autoplay: true, playsInline: true, muted: true });
  const avatar = h('div', { class: 'avatar avatar-lg' });
  const tileStatus = h('div', { class: 'tile-status' }, 'Starting camera…');
  const meterFill = h('div', { class: 'meter-fill' });
  const meter = h('div', { class: 'meter', title: 'Microphone level' }, meterFill);

  const micButton = h('button', { class: 'round-btn', type: 'button', onClick: () => toggleMic() });
  const camButton = h('button', { class: 'round-btn', type: 'button', onClick: () => void toggleCam() });

  const nameInput = h('input', {
    class: 'input',
    type: 'text',
    maxLength: MAX_NAME_LENGTH,
    placeholder: 'Your name',
    'aria-label': 'Your name',
    value: localStorage.getItem(NAME_KEY) ?? '',
  });
  const cameraSelect = h('select', { class: 'input', 'aria-label': 'Camera' });
  const micSelect = h('select', { class: 'input', 'aria-label': 'Microphone' });
  const warning = h('p', { class: 'lobby-warning', hidden: true });
  const joinButton = h('button', { class: 'btn btn-primary btn-lg', type: 'submit', disabled: true }, 'Join now');

  const link = roomUrl(opts.roomId);

  const tile = h(
    'div',
    { class: 'tile lobby-tile' },
    video,
    h('div', { class: 'tile-avatar' }, avatar),
    tileStatus,
    h('div', { class: 'lobby-tile-controls' }, micButton, camButton),
    meter,
  );

  const form = h(
    'form',
    {
      class: 'lobby-panel',
      onSubmit: (event: Event) => {
        event.preventDefault();
        join();
      },
    },
    h('h1', {}, 'Ready to join?'),
    h(
      'div',
      { class: 'room-chip' },
      h('span', { class: 'room-code' }, opts.roomId),
      h(
        'button',
        {
          class: 'btn btn-text btn-sm',
          type: 'button',
          onClick: async () => showToast((await copyText(link)) ? 'Link copied' : link),
        },
        icon('copy'),
        'Copy link',
      ),
    ),
    h('label', { class: 'field' }, h('span', {}, 'Name'), nameInput),
    h('label', { class: 'field' }, h('span', {}, 'Camera'), cameraSelect),
    h('label', { class: 'field' }, h('span', {}, 'Microphone'), micSelect),
    warning,
    h(
      'div',
      { class: 'lobby-actions' },
      joinButton,
      h('button', { class: 'btn btn-outline btn-lg', type: 'button', onClick: () => navigate('') }, 'Back'),
    ),
  );

  const page = h(
    'main',
    { class: 'lobby' },
    h('header', { class: 'topbar' }, renderBrand()),
    h('section', { class: 'lobby-body' }, tile, form),
  );
  container.replaceChildren(page);

  function setWarning(message?: string) {
    warning.hidden = !message;
    warning.textContent = message ?? '';
  }

  function render() {
    const audioTrack = stream.getAudioTracks()[0];
    const videoTrack = stream.getVideoTracks()[0];

    micButton.replaceChildren(icon(micOn && audioTrack ? 'mic' : 'micOff'));
    micButton.classList.toggle('is-off', !(micOn && audioTrack));
    micButton.setAttribute('aria-label', micOn ? 'Turn off microphone' : 'Turn on microphone');
    micButton.setAttribute('aria-pressed', String(!micOn));

    camButton.replaceChildren(icon(camOn && videoTrack ? 'cam' : 'camOff'));
    camButton.classList.toggle('is-off', !(camOn && videoTrack));
    camButton.setAttribute('aria-label', camOn ? 'Turn off camera' : 'Turn on camera');
    camButton.setAttribute('aria-pressed', String(!camOn));

    tile.classList.toggle('video-off', !videoTrack);
    tileStatus.hidden = true;
    if (!videoTrack) {
      tileStatus.hidden = false;
      tileStatus.textContent = camOn ? 'Camera unavailable' : 'Camera is off';
    }
    avatar.textContent = initials(nameInput.value || 'You');
    meter.hidden = !(micOn && audioTrack);
    attachStream(video, videoTrack ? new MediaStream([videoTrack]) : null);
  }

  function restartMeter() {
    stopMeter?.();
    stopMeter = null;
    const audioTrack = stream.getAudioTracks()[0];
    if (!audioTrack) return;
    try {
      stopMeter = createLevelMeter(audioTrack, (level) => {
        meterFill.style.transform = `scaleX(${micOn ? level : 0})`;
      });
    } catch {
      // Level meter is cosmetic; ignore AudioContext failures.
    }
  }

  async function refreshDevices() {
    try {
      const { audioInputs, videoInputs } = await listDevices();
      audioDeviceId = stream.getAudioTracks()[0]?.getSettings().deviceId ?? audioDeviceId;
      videoDeviceId = stream.getVideoTracks()[0]?.getSettings().deviceId ?? videoDeviceId;
      fillSelect(micSelect, audioInputs, audioDeviceId, 'Microphone');
      fillSelect(cameraSelect, videoInputs, videoDeviceId, 'Camera');
    } catch {
      // Device enumeration can fail on insecure origins; selects stay empty.
    }
  }

  function replaceTrack(kind: 'audio' | 'video', track: MediaStreamTrack | null) {
    for (const old of kind === 'audio' ? stream.getAudioTracks() : stream.getVideoTracks()) {
      old.stop();
      stream.removeTrack(old);
    }
    if (track) stream.addTrack(track);
  }

  function toggleMic() {
    const track = stream.getAudioTracks()[0];
    if (!track) {
      void switchMic(audioDeviceId);
      return;
    }
    micOn = !micOn;
    track.enabled = micOn;
    render();
  }

  async function toggleCam() {
    if (busy) return;
    if (camOn && stream.getVideoTracks()[0]) {
      camOn = false;
      replaceTrack('video', null);
      render();
      return;
    }
    camOn = true;
    await switchCamera(videoDeviceId);
  }

  async function switchCamera(deviceId?: string) {
    if (busy) return;
    busy = true;
    try {
      const track = await acquireCamera(deviceId);
      if (disposed) return track.stop();
      replaceTrack('video', track);
      videoDeviceId = track.getSettings().deviceId ?? deviceId;
      camOn = true;
      setWarning();
    } catch (err) {
      setWarning(describeMediaError(err));
    } finally {
      busy = false;
      render();
    }
  }

  async function switchMic(deviceId?: string) {
    if (busy) return;
    busy = true;
    try {
      const track = await acquireMicrophone(deviceId);
      if (disposed) return track.stop();
      track.enabled = micOn;
      replaceTrack('audio', track);
      audioDeviceId = track.getSettings().deviceId ?? deviceId;
      restartMeter();
      setWarning();
    } catch (err) {
      setWarning(describeMediaError(err));
    } finally {
      busy = false;
      render();
    }
  }

  cameraSelect.addEventListener('change', () => {
    videoDeviceId = cameraSelect.value;
    if (camOn) void switchCamera(videoDeviceId);
  });
  micSelect.addEventListener('change', () => void switchMic(micSelect.value));
  nameInput.addEventListener('input', render);
  navigator.mediaDevices?.addEventListener?.('devicechange', refreshDevices);

  function join() {
    if (joinButton.disabled) return;
    const name = nameInput.value.trim().slice(0, MAX_NAME_LENGTH) || 'Guest';
    localStorage.setItem(NAME_KEY, name);
    handedOff = true;
    opts.onJoin({ name, stream, micOn, audioDeviceId, videoDeviceId });
  }

  (async () => {
    const result = await acquireMedia({ audio: true, video: true });
    if (disposed) return stopStream(result.stream);
    stream = result.stream;
    camOn = stream.getVideoTracks().length > 0;
    setWarning(result.warning);
    await refreshDevices();
    restartMeter();
    joinButton.disabled = false;
    render();
    if (!nameInput.value) nameInput.focus();
  })();

  render();
  tileStatus.hidden = false;
  tileStatus.textContent = 'Starting camera…';

  return () => {
    disposed = true;
    stopMeter?.();
    navigator.mediaDevices?.removeEventListener?.('devicechange', refreshDevices);
    if (!handedOff) stopStream(stream);
    page.remove();
  };
}

function fillSelect(select: HTMLSelectElement, devices: MediaDeviceInfo[], selectedId: string | undefined, fallback: string) {
  select.replaceChildren(
    ...devices.map((d, i) => h('option', { value: d.deviceId, selected: d.deviceId === selectedId }, d.label || `${fallback} ${i + 1}`)),
  );
  if (!devices.length) select.replaceChildren(h('option', { value: '' }, `No ${fallback.toLowerCase()} found`));
  select.disabled = devices.length === 0;
}
