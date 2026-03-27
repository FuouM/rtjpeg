import { CACHE_LIMIT_BYTES } from "../runtime/constants";
import type { RawFrame } from "../runtime/types";

const DEBUG_MEDIA_LOGS = import.meta.env.DEV;

/**
 * Bridges ghost-cache / MP4 demux logic to `main.ts` GPU + timeline state.
 * Kept explicit so the heavy mp4box + VideoDecoder flow stays in one file.
 */
export interface GhostCacheDeps {
  ensureGpuReady: () => Promise<boolean>;
  get device(): GPUDevice;
  get useCanvasVideoSource(): boolean;
  get isOfflineRendering(): boolean;
  get isSeeking(): boolean;
  get sourceVideoPaused(): boolean;
  get currentCacheBytes(): number;
  setVideoAllPresentationTimesSorted: (v: Float64Array | null) => void;
  clearPresentationTimes: () => void;
  syncRawFrameSlotBasis: () => void;
  queueMicrotaskPtsAndTimeline: () => void;
  queueMicrotaskMetadataUi: () => void;
  queueMicrotaskDecoderFailUi: () => void;
  queueMicrotaskAfterFlush: () => void;
  insertRawFrame: (f: RawFrame) => boolean;
  updateCacheCanvas: () => void;
  updateCacheStatusText: () => void;
  updateTimeDisplayText: () => void;
  drawTimeline: () => void;
  getDetectedVideoFPS: () => number | null;
  setDetectedVideoFPS: (v: number | null) => void;
  setOfflineFps: (v: number) => void;
  onFpsEstimateChangedWhileHavePts: () => void;
}

let ghostAbortController: AbortController | null = null;
const GHOST_CACHE_TEXTURE_UPLOAD_FAIL_LOG_MAX = 3;
let ghostCacheTextureUploadFailLogCount = 0;

export function stopGhostCache(): void {
  if (ghostAbortController) {
    ghostAbortController.abort();
    ghostAbortController = null;
  }
}

export async function startGhostCache(
  url: string,
  populateFrameCache: boolean,
  deps: GhostCacheDeps,
): Promise<void> {
  if (populateFrameCache && !(await deps.ensureGpuReady())) return;
  stopGhostCache();
  ghostCacheTextureUploadFailLogCount = 0;
  ghostAbortController = new AbortController();
  const signal = ghostAbortController.signal;
  deps.clearPresentationTimes();

  const canDecodeIntoGhostCache =
    populateFrameCache &&
    !deps.useCanvasVideoSource &&
    typeof VideoDecoder !== "undefined";

  if (DEBUG_MEDIA_LOGS) {
    console.debug(
      canDecodeIntoGhostCache
        ? "[rtjpeg] ghost cache: VideoDecoder frame prewarm"
        : "[rtjpeg] ghost cache: MP4 timing metadata only",
    );
  }

  let decoder: VideoDecoder | null = null;
  try {
    const { createFile, DataStream, Endianness } = await import("mp4box");
    function getVideoDecoderDescription(
      mp4boxFile: { getTrackById?: (id: number) => unknown },
      trackId: number,
    ): Uint8Array | undefined {
      const trak = mp4boxFile.getTrackById?.(trackId) as
        | {
            mdia?: {
              minf?: { stbl?: { stsd?: { entries?: unknown[] } } };
            };
          }
        | undefined;
      const entries = trak?.mdia?.minf?.stbl?.stsd?.entries;
      if (!Array.isArray(entries)) return undefined;

      for (const entry of entries) {
        const e = entry as {
          avcC?: { write?: (s: unknown) => void; hdr_size?: number };
          hvcC?: { write?: (s: unknown) => void; hdr_size?: number };
          vpcC?: { write?: (s: unknown) => void; hdr_size?: number };
          av1C?: { write?: (s: unknown) => void; hdr_size?: number };
        };
        const box = e.avcC ?? e.hvcC ?? e.vpcC ?? e.av1C;
        if (!box?.write) continue;

        const stream = new DataStream(undefined, 0, Endianness.BIG_ENDIAN);
        box.write(stream);
        const headerSize = typeof box.hdr_size === "number" ? box.hdr_size : 8;
        return new Uint8Array(stream.buffer, headerSize);
      }

      return undefined;
    }

    const response = await fetch(url, { signal });
    if (!response.body) throw new Error("No body");

    const mp4box = createFile();
    let videoTrack: {
      id: number;
      codec: string;
      track_width: number;
      track_height: number;
      description?: AllowSharedBufferSource;
    } | null = null;
    let framesSeen = 0;
    let firstMediaTime: number | null = null;
    let sawGhostKeyFrame = false;

    mp4box.onReady = (info: { videoTracks: (typeof videoTrack)[] }) => {
      videoTrack = info.videoTracks[0] ?? null;
      if (!videoTrack) return;

      try {
        const trak = (
          mp4box as {
            getTrackById?: (id: number) => {
              samples?: { cts: number; timescale: number }[];
            };
          }
        ).getTrackById?.(videoTrack.id);
        const samples = trak?.samples;
        if (samples && samples.length > 0) {
          const pts: number[] = [];
          for (let i = 0; i < samples.length; i++) {
            const s = samples[i];
            pts.push(s.cts / s.timescale);
          }
          pts.sort((a, b) => a - b);
          deps.setVideoAllPresentationTimesSorted(Float64Array.from(pts));
          deps.syncRawFrameSlotBasis();
          deps.queueMicrotaskPtsAndTimeline();
        }
      } catch {
        deps.clearPresentationTimes();
      }

      if (!canDecodeIntoGhostCache) {
        if (DEBUG_MEDIA_LOGS) {
          console.info(
            "[rtjpeg] skipping VideoDecoder frame cache on this browser",
          );
        }
        deps.queueMicrotaskMetadataUi();
        return;
      }

      decoder = new VideoDecoder({
        output: (frame) => {
          if (signal.aborted) {
            frame.close();
            return;
          }
          const t = frame.timestamp / 1000000;

          if (firstMediaTime === null) firstMediaTime = t;
          framesSeen++;

          if (framesSeen > 20 && t > firstMediaTime) {
            const prev = deps.getDetectedVideoFPS();
            let next = (framesSeen - 1) / (t - firstMediaTime);
            if (Math.abs(next - 23.976) < 0.1) next = 23.976;
            else if (Math.abs(next - 24) < 0.1) next = 24;
            else if (Math.abs(next - 25) < 0.1) next = 25;
            else if (Math.abs(next - 29.97) < 0.1) next = 29.97;
            else if (Math.abs(next - 30) < 0.1) next = 30;
            else if (Math.abs(next - 60) < 0.1) next = 60;
            deps.setDetectedVideoFPS(next);
            deps.setOfflineFps(Math.round(next * 100) / 100);
            if (prev !== next) {
              deps.onFpsEstimateChangedWhileHavePts();
            }
          }

          if (
            deps.isOfflineRendering ||
            deps.sourceVideoPaused ||
            deps.isSeeking
          ) {
            frame.close();
            return;
          }

          if (deps.currentCacheBytes < CACHE_LIMIT_BYTES) {
            try {
              const tex = deps.device.createTexture({
                size: [frame.displayWidth, frame.displayHeight, 1],
                format: "rgba8unorm",
                usage:
                  GPUTextureUsage.TEXTURE_BINDING |
                  GPUTextureUsage.COPY_DST |
                  GPUTextureUsage.RENDER_ATTACHMENT,
              });
              deps.device.queue.copyExternalImageToTexture(
                { source: frame },
                { texture: tex },
                [frame.displayWidth, frame.displayHeight],
              );
              if (
                deps.insertRawFrame({
                  time: t,
                  texture: tex,
                  view: tex.createView(),
                  slot: null,
                })
              ) {
                deps.updateCacheCanvas();
                deps.updateCacheStatusText();
              }
            } catch (e) {
              if (
                ghostCacheTextureUploadFailLogCount <
                GHOST_CACHE_TEXTURE_UPLOAD_FAIL_LOG_MAX
              ) {
                ghostCacheTextureUploadFailLogCount++;
                if (DEBUG_MEDIA_LOGS) {
                  console.debug(
                    "[rtjpeg] ghost cache texture upload failed",
                    e,
                  );
                }
              }
            }
          }
          frame.close();

          if (deps.currentCacheBytes >= CACHE_LIMIT_BYTES) {
            if (DEBUG_MEDIA_LOGS) {
              console.debug(
                "[rtjpeg] ghost cache: frame cache byte limit reached",
              );
            }
            decoder?.close();
            ghostAbortController?.abort();
          }
        },
        error: (e) => console.error("VideoDecoder error:", e),
      });

      const config: VideoDecoderConfig = {
        codec: videoTrack.codec,
        codedWidth: videoTrack.track_width,
        codedHeight: videoTrack.track_height,
        description:
          videoTrack.description ??
          getVideoDecoderDescription(
            mp4box as { getTrackById?: (id: number) => unknown },
            videoTrack.id,
          ),
      };

      try {
        decoder.configure(config);
      } catch (error) {
        console.warn(
          "[rtjpeg] ghost cache decoder config failed, using metadata-only frame counts",
          error,
        );
        decoder.close();
        decoder = null;
        deps.queueMicrotaskDecoderFailUi();
        return;
      }
      mp4box.setExtractionOptions(videoTrack.id, null, { nbSamples: 100 });
      mp4box.start();
    };

    mp4box.onSamples = (_id: unknown, _user: unknown, samples: unknown[]) => {
      if (signal.aborted) return;
      if (!decoder) return;
      for (const sample of samples as {
        is_sync: boolean;
        cts: number;
        timescale: number;
        duration: number;
        data: AllowSharedBufferSource;
      }[]) {
        if (!sawGhostKeyFrame) {
          if (!sample.is_sync) continue;
          sawGhostKeyFrame = true;
        }
        decoder?.decode(
          new EncodedVideoChunk({
            type: sample.is_sync ? "key" : "delta",
            timestamp: (sample.cts * 1000000) / sample.timescale,
            duration: (sample.duration * 1000000) / sample.timescale,
            data: sample.data,
          }),
        );
      }
    };

    const reader = response.body.getReader();
    let offset = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done || signal.aborted) break;
      const buffer = value.buffer as ArrayBuffer & { fileStart: number };
      buffer.fileStart = offset;
      mp4box.appendBuffer(buffer);
      offset += value.length;
    }
    if (!signal.aborted) {
      (mp4box as { flush?: () => void }).flush?.();
      const activeDecoder = decoder as
        | (VideoDecoder & { flush: () => Promise<void> })
        | null;
      if (activeDecoder) {
        await activeDecoder.flush();
      }
      deps.queueMicrotaskAfterFlush();
    }
  } catch (e) {
    if ((e as Error).name !== "AbortError")
      console.error("Ghost cache failed:", e);
  } finally {
    const toClose = decoder as VideoDecoder | null;
    decoder = null;
    if (toClose !== null) {
      try {
        if (toClose.state !== "closed") {
          toClose.close();
        }
      } catch {
        /* ignore */
      }
    }
  }
}
