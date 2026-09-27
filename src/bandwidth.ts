export interface VideoEncoding {
  maxBitrate: number;
  scaleResolutionDownBy: number;
  maxFramerate: number;
}

/**
 * In a mesh every participant encodes a separate copy of their video for each
 * peer, so the per-peer budget shrinks as the room grows to keep total upload
 * within what a typical home connection sustains (roughly 3 to 4 Mbps).
 * Screen shares keep full resolution for legible text and trade frame rate instead.
 */
export function videoEncodingFor(peerCount: number, isScreen: boolean): VideoEncoding {
  const peers = Math.max(1, peerCount);
  if (isScreen) {
    if (peers <= 1) return { maxBitrate: 2_500_000, scaleResolutionDownBy: 1, maxFramerate: 15 };
    if (peers <= 3) return { maxBitrate: 1_200_000, scaleResolutionDownBy: 1, maxFramerate: 10 };
    if (peers <= 5) return { maxBitrate: 700_000, scaleResolutionDownBy: 1, maxFramerate: 8 };
    return { maxBitrate: 450_000, scaleResolutionDownBy: 1, maxFramerate: 5 };
  }
  if (peers <= 1) return { maxBitrate: 1_500_000, scaleResolutionDownBy: 1, maxFramerate: 30 };
  if (peers <= 3) return { maxBitrate: 900_000, scaleResolutionDownBy: 1.5, maxFramerate: 30 };
  if (peers <= 5) return { maxBitrate: 550_000, scaleResolutionDownBy: 2, maxFramerate: 24 };
  return { maxBitrate: 350_000, scaleResolutionDownBy: 3, maxFramerate: 20 };
}
