import { describe, expect, it } from 'vitest';
import { videoEncodingFor } from './bandwidth';
import { ROOM_CAPACITY } from './roster';

describe('videoEncodingFor', () => {
  it('lowers the per-peer bitrate as the room grows', () => {
    let previous = Infinity;
    for (let peers = 1; peers < ROOM_CAPACITY; peers++) {
      const { maxBitrate } = videoEncodingFor(peers, false);
      expect(maxBitrate).toBeLessThanOrEqual(previous);
      previous = maxBitrate;
    }
  });

  it('keeps total camera upload under 4 Mbps for a full room', () => {
    const peers = ROOM_CAPACITY - 1;
    expect(videoEncodingFor(peers, false).maxBitrate * peers).toBeLessThanOrEqual(4_000_000);
    expect(videoEncodingFor(peers, true).maxBitrate * peers).toBeLessThanOrEqual(4_500_000);
  });

  it('never downscales screen shares', () => {
    for (let peers = 1; peers < ROOM_CAPACITY; peers++) {
      expect(videoEncodingFor(peers, true).scaleResolutionDownBy).toBe(1);
    }
  });

  it('treats an empty room like a 1:1 call', () => {
    expect(videoEncodingFor(0, false)).toEqual(videoEncodingFor(1, false));
  });
});
