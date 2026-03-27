/** Firefox upload path uses ffmpeg.wasm; keep this out of `videoTranscoder.ts` so the main chunk can lazy-load FFmpeg. */
export function shouldWarmVideoTranscoder(): boolean {
  return /\bfirefox\/\d+/i.test(navigator.userAgent);
}
