import { FFmpeg } from "@ffmpeg/ffmpeg";
import { fetchFile } from "@ffmpeg/util";
import ffmpegCoreUrl from "@ffmpeg/core?url";
import ffmpegWasmUrl from "@ffmpeg/core/wasm?url";
import { TRANSCODE_DISK_CACHE_NAME } from "../runtime/constants";
const FIREFOX_SAFE_MP4_MIME = "video/mp4";
const VIDEO_PROBE_TIMEOUT_MS = 5000;
const EVEN_DIMENSIONS_FILTER =
  "scale=trunc(iw/2)*2:trunc(ih/2)*2,format=yuv420p";
const DEBUG_MEDIA_LOGS = import.meta.env.DEV;

const ffmpeg = new FFmpeg();
let ffmpegLoadPromise: Promise<void> | null = null;
let ffmpegProgressCallback: ((progress: number) => void) | null = null;
let ffmpegProgressEventsBound = false;
let transcodeJobCounter = 0;

export interface PreparedVideoUpload {
  blob: Blob;
  fileName: string;
  transcoded: boolean;
  fromCache: boolean;
}

interface Mp4VideoTrackProbe {
  codec: string;
  width: number;
  height: number;
  description?: Uint8Array;
}

interface PrepareVideoUploadOptions {
  signal?: AbortSignal;
  onStatus?: (message: string) => void;
  /** Overrides default "Writing upload into ffmpeg…" */
  writingStatusMessage?: string;
  /** Overrides default upload transcode progress label; argument is 0–100. */
  progressPercentMessage?: (percent: number) => string;
  /** 0–100 while ffmpeg is encoding (optional UI, e.g. timeline bar). */
  onTranscodeProgress?: (percent: number) => void;
  /**
   * When true (downloaded exports only): video-only libx264 + `mp42` ftyp brand + faststart.
   * Upload transcode uses plain video-only without forcing `mp42`.
   */
  exportShellCompat?: boolean;
}

export async function warmVideoTranscoder(signal?: AbortSignal): Promise<void> {
  await ensureFfmpegLoaded(() => {}, signal);
}

export async function prepareVideoUpload(
  file: File,
  options: PrepareVideoUploadOptions = {},
): Promise<PreparedVideoUpload> {
  if (DEBUG_MEDIA_LOGS) {
    console.info("[rtjpeg] preparing uploaded video", {
      name: file.name,
      type: file.type,
      size: file.size,
    });
  }
  options.onStatus?.("Checking whether upload is already compatible...");
  if (await canUseUploadWithoutTranscode(file, options.signal)) {
    if (DEBUG_MEDIA_LOGS) {
      console.info("[rtjpeg] using original upload without transcode", {
        name: file.name,
      });
    }
    options.onStatus?.("Using original MP4 upload.");
    return {
      blob: file,
      fileName: file.name,
      transcoded: false,
      fromCache: false,
    };
  }
  options.onStatus?.("Checking local transcoded cache...");
  const cachedBlob = await readCachedTranscode(file);
  if (cachedBlob && (await probePlayableBlob(cachedBlob, options.signal))) {
    if (DEBUG_MEDIA_LOGS) {
      console.info("[rtjpeg] using cached transcoded upload", {
        name: file.name,
      });
    }
    options.onStatus?.("Using cached transcoded MP4.");
    return {
      blob: cachedBlob,
      fileName: replaceExtension(file.name, ".mp4"),
      transcoded: true,
      fromCache: true,
    };
  }
  if (cachedBlob) {
    await deleteCachedTranscode(file);
  }

  await ensureFfmpegLoaded(
    (message) => options.onStatus?.(message),
    options.signal,
  );
  if (DEBUG_MEDIA_LOGS) {
    console.info("[rtjpeg] starting ffmpeg transcode", { name: file.name });
  }
  const transcodedBlob = await transcodeVideoToMp4Internal(file, options);
  if (!(await probePlayableBlob(transcodedBlob, options.signal))) {
    throw new Error("The transcoded MP4 is still not playable here.");
  }
  await writeCachedTranscode(file, transcodedBlob);
  if (DEBUG_MEDIA_LOGS) {
    console.info("[rtjpeg] finished ffmpeg transcode", {
      name: file.name,
      outputBytes: transcodedBlob.size,
    });
  }
  options.onStatus?.("Transcoded MP4 ready.");
  return {
    blob: transcodedBlob,
    fileName: replaceExtension(file.name, ".mp4"),
    transcoded: true,
    fromCache: false,
  };
}

function bindFfmpegProgressEvents(): void {
  if (ffmpegProgressEventsBound) return;
  ffmpeg.on("progress", ({ progress }) => {
    ffmpegProgressCallback?.(progress);
  });
  ffmpegProgressEventsBound = true;
}

async function ensureFfmpegLoaded(
  onStatus?: (message: string) => void,
  signal?: AbortSignal,
): Promise<void> {
  throwIfAborted(signal);
  bindFfmpegProgressEvents();
  if (ffmpeg.loaded) return;
  onStatus?.("Downloading ffmpeg core...");

  if (!ffmpegLoadPromise) {
    ffmpegLoadPromise = ffmpeg
      .load(
        {
          coreURL: ffmpegCoreUrl,
          wasmURL: ffmpegWasmUrl,
        },
        { signal },
      )
      .then(() => undefined)
      .catch((error) => {
        ffmpegLoadPromise = null;
        throw error;
      });
  }

  await ffmpegLoadPromise;
}

/** Re-encode WebCodecs output: libx264 baseline, yuv420p, faststart, `mp42` brand (video-only). */
export async function transcodeExportMp4ForDevicePlayback(
  mp4Blob: Blob,
  options: Pick<PrepareVideoUploadOptions, "signal" | "onStatus"> = {},
): Promise<Blob> {
  await ensureFfmpegLoaded(
    (message) => options.onStatus?.(message),
    options.signal,
  );
  const file = new File([mp4Blob], "rtjpeg-export.mp4", {
    type: FIREFOX_SAFE_MP4_MIME,
  });
  return transcodeVideoToMp4Internal(file, {
    ...options,
    exportShellCompat: true,
    writingStatusMessage: "Finalizing MP4 for playback & thumbnails…",
    progressPercentMessage: (p) => `Finalizing… ${p}%`,
  });
}

async function transcodeVideoToMp4Internal(
  file: File,
  options: PrepareVideoUploadOptions,
): Promise<Blob> {
  throwIfAborted(options.signal);
  options.onStatus?.(
    options.writingStatusMessage ?? "Writing upload into ffmpeg...",
  );
  if (DEBUG_MEDIA_LOGS) {
    console.info("[rtjpeg] writing upload into ffmpeg", { name: file.name });
  }

  const jobId = `${Date.now()}-${transcodeJobCounter++}`;
  const inputPath = `input-${jobId}${preferredInputExtension(file)}`;
  const outputPath = `output-${jobId}.mp4`;

  options.onTranscodeProgress?.(0);

  ffmpegProgressCallback = (progress) => {
    const clamped = Math.max(0, Math.min(progress, 0.999));
    const pct = Math.round(clamped * 100);
    options.onTranscodeProgress?.(pct);
    options.onStatus?.(
      options.progressPercentMessage?.(pct) ?? `Transcoding… ${pct}%`,
    );
  };

  try {
    await ffmpeg.writeFile(inputPath, await fetchFile(file), {
      signal: options.signal,
    });

    const videoEncodeArgs = [
      "-vf",
      EVEN_DIMENSIONS_FILTER,
      "-c:v",
      "libx264",
      "-preset",
      "ultrafast",
      "-profile:v",
      "baseline",
      // Let libx264 set level from frame size + rate. A fixed 3.1 breaks 1080p/4K on strict decoders.
      "-pix_fmt",
      "yuv420p",
      "-g",
      "30",
      "-bf",
      "0",
      "-tag:v",
      "avc1",
      // Preserve incoming timestamps so VFR offline renders do not get padded
      // back onto a constant-rate grid during the compatibility transcode.
      "-fps_mode",
      "passthrough",
    ];

    const videoOnlyMp4 = [
      "-hide_banner",
      "-i",
      inputPath,
      "-map",
      "0:v:0",
      ...videoEncodeArgs,
      "-movflags",
      "+faststart",
      "-an",
      outputPath,
    ];

    const videoOnlyMp42Brand = [
      "-hide_banner",
      "-i",
      inputPath,
      "-map",
      "0:v:0",
      ...videoEncodeArgs,
      "-movflags",
      "+faststart",
      "-brand",
      "mp42",
      "-an",
      outputPath,
    ];

    throwIfAborted(options.signal);

    let exitCode: number;
    if (options.exportShellCompat) {
      exitCode = await ffmpeg.exec(videoOnlyMp42Brand, undefined, {
        signal: options.signal,
      });
      if (exitCode !== 0) {
        console.warn(
          "[rtjpeg] ffmpeg: mp42 brand path failed; retrying upload-style video-only.",
        );
        await safeDeleteFile(outputPath);
        exitCode = await ffmpeg.exec(videoOnlyMp4, undefined, {
          signal: options.signal,
        });
      }
    } else {
      exitCode = await ffmpeg.exec(videoOnlyMp4, undefined, {
        signal: options.signal,
      });
    }

    if (exitCode !== 0) {
      throw new Error(`ffmpeg exited with code ${exitCode}.`);
    }

    options.onTranscodeProgress?.(100);

    const data = await ffmpeg.readFile(outputPath, undefined, {
      signal: options.signal,
    });
    if (!(data instanceof Uint8Array)) {
      throw new Error("ffmpeg returned an unexpected output payload.");
    }

    const outputBytes = data.slice().buffer;
    return new Blob([outputBytes], { type: FIREFOX_SAFE_MP4_MIME });
  } finally {
    ffmpegProgressCallback = null;
    await safeDeleteFile(inputPath);
    await safeDeleteFile(outputPath);
  }
}

async function canUseUploadWithoutTranscode(
  file: File,
  signal?: AbortSignal,
): Promise<boolean> {
  throwIfAborted(signal);
  if (!looksLikeMp4Upload(file)) return false;
  if (!(await probePlayableBlob(file, signal))) return false;

  const track = await probeMp4VideoTrack(file, signal);
  if (!track) return false;
  if (!/^avc[13](?:\.|$)/i.test(track.codec)) return false;
  if (track.width <= 0 || track.height <= 0) return false;
  if (track.width % 2 !== 0 || track.height % 2 !== 0) return false;

  if (typeof VideoDecoder === "undefined") {
    return true;
  }

  try {
    const { supported } = await VideoDecoder.isConfigSupported({
      codec: track.codec,
      codedWidth: track.width,
      codedHeight: track.height,
      description: track.description,
    });
    return supported ?? false;
  } catch {
    return false;
  }
}

function looksLikeMp4Upload(file: File): boolean {
  if (file.type === FIREFOX_SAFE_MP4_MIME) return true;
  return /\.(mp4|m4v)$/i.test(file.name);
}

async function probeMp4VideoTrack(
  file: File,
  signal?: AbortSignal,
): Promise<Mp4VideoTrackProbe | null> {
  const { createFile, DataStream, Endianness } = await import("mp4box");

  function toUint8Array(
    description: AllowSharedBufferSource,
  ): Uint8Array<ArrayBufferLike> {
    if (description instanceof Uint8Array) return description;
    if (description instanceof ArrayBuffer) return new Uint8Array(description);
    if (
      typeof SharedArrayBuffer !== "undefined" &&
      description instanceof SharedArrayBuffer
    ) {
      return new Uint8Array(description);
    }
    const view = description as ArrayBufferView;
    return new Uint8Array(view.buffer, view.byteOffset, view.byteLength);
  }

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

  const mp4box = createFile();
  let settled = false;

  const result = new Promise<Mp4VideoTrackProbe | null>((resolve) => {
    const finish = (value: Mp4VideoTrackProbe | null) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };

    mp4box.onError = () => finish(null);
    mp4box.onReady = (info: {
      videoTracks?: Array<{
        id: number;
        codec: string;
        track_width: number;
        track_height: number;
        description?: AllowSharedBufferSource;
      }>;
    }) => {
      const videoTrack = info.videoTracks?.[0];
      if (!videoTrack) {
        finish(null);
        return;
      }
      finish({
        codec: videoTrack.codec,
        width: videoTrack.track_width,
        height: videoTrack.track_height,
        description:
          (videoTrack.description
            ? toUint8Array(videoTrack.description)
            : undefined) ??
          getVideoDecoderDescription(
            mp4box as { getTrackById?: (id: number) => unknown },
            videoTrack.id,
          ),
      });
    };
  });

  const reader = file.stream().getReader();
  let offset = 0;

  try {
    while (!settled) {
      throwIfAborted(signal);
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = value.slice();
      const buffer = chunk.buffer as ArrayBuffer & { fileStart: number };
      buffer.fileStart = offset;
      mp4box.appendBuffer(buffer);
      offset += chunk.byteLength;
    }
    if (!settled) {
      (mp4box as { flush?: () => void }).flush?.();
    }
    if (!settled) {
      return null;
    }
    return await result;
  } catch (error) {
    await reader.cancel(error);
    if ((error as Error).name === "AbortError") throw error;
    return null;
  } finally {
    reader.releaseLock();
  }
}

async function probePlayableBlob(
  blob: Blob,
  signal?: AbortSignal,
): Promise<boolean> {
  throwIfAborted(signal);

  return await new Promise<boolean>((resolve, reject) => {
    const probeVideo = document.createElement("video");
    probeVideo.preload = "metadata";
    probeVideo.muted = true;
    probeVideo.playsInline = true;

    const objectUrl = URL.createObjectURL(blob);
    let settled = false;
    let timeoutId = 0;

    const cleanup = () => {
      probeVideo.removeEventListener("canplaythrough", handleCanPlayThrough);
      probeVideo.removeEventListener("error", handleError);
      signal?.removeEventListener("abort", handleAbort);
      window.clearTimeout(timeoutId);
      probeVideo.pause();
      probeVideo.removeAttribute("src");
      probeVideo.load();
      URL.revokeObjectURL(objectUrl);
    };

    const finish = (result: boolean) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(result);
    };

    const fail = (error: Error) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    };

    const handleCanPlayThrough = () => finish(true);
    const handleError = () => finish(false);
    const handleAbort = () => fail(createAbortError());

    probeVideo.addEventListener("canplaythrough", handleCanPlayThrough, {
      once: true,
    });
    probeVideo.addEventListener("error", handleError, { once: true });
    signal?.addEventListener("abort", handleAbort, { once: true });

    timeoutId = window.setTimeout(() => finish(false), VIDEO_PROBE_TIMEOUT_MS);
    probeVideo.src = objectUrl;
    probeVideo.load();
  });
}

async function readCachedTranscode(file: File): Promise<Blob | null> {
  if (!("caches" in window)) return null;
  try {
    const cache = await caches.open(TRANSCODE_DISK_CACHE_NAME);
    const response = await cache.match(transcodeCacheKey(file));
    if (!response?.ok) return null;
    const blob = await response.blob();
    if (blob.type === FIREFOX_SAFE_MP4_MIME) return blob;
    return new Blob([await blob.arrayBuffer()], {
      type: FIREFOX_SAFE_MP4_MIME,
    });
  } catch {
    return null;
  }
}

async function writeCachedTranscode(file: File, blob: Blob): Promise<void> {
  if (!("caches" in window)) return;
  try {
    const cache = await caches.open(TRANSCODE_DISK_CACHE_NAME);
    await cache.put(
      transcodeCacheKey(file),
      new Response(blob, {
        headers: {
          "Content-Type": FIREFOX_SAFE_MP4_MIME,
          "X-RTJPEG-Source-Name": file.name,
        },
      }),
    );
  } catch {
    // Cache quota or Cache API support should not block playback.
  }
}

async function deleteCachedTranscode(file: File): Promise<void> {
  if (!("caches" in window)) return;
  try {
    const cache = await caches.open(TRANSCODE_DISK_CACHE_NAME);
    await cache.delete(transcodeCacheKey(file));
  } catch {
    // Ignore cache cleanup failures.
  }
}

function transcodeCacheKey(file: File): string {
  const url = new URL(
    `${import.meta.env.BASE_URL}__rtjpeg_firefox_safe_transcodes__`,
    location.href,
  );
  url.searchParams.set("name", file.name);
  url.searchParams.set("size", String(file.size));
  url.searchParams.set("modified", String(file.lastModified));
  url.searchParams.set("type", file.type || "video/unknown");
  return url.toString();
}

function preferredInputExtension(file: File): string {
  const name = file.name.trim();
  const dotIndex = name.lastIndexOf(".");
  if (dotIndex > -1 && dotIndex < name.length - 1) {
    return name.slice(dotIndex);
  }
  const subtype = file.type.split("/")[1]?.trim();
  if (subtype) return `.${subtype}`;
  return ".video";
}

function replaceExtension(fileName: string, nextExtension: string): string {
  const trimmed = fileName.trim();
  const dotIndex = trimmed.lastIndexOf(".");
  if (dotIndex <= 0) return `${trimmed || "upload"}${nextExtension}`;
  return `${trimmed.slice(0, dotIndex)}${nextExtension}`;
}

async function safeDeleteFile(path: string): Promise<void> {
  try {
    await ffmpeg.deleteFile(path);
  } catch {
    // Best-effort cleanup inside ffmpeg MEMFS.
  }
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw createAbortError();
  }
}

function createAbortError(): Error {
  try {
    return new DOMException("Operation aborted.", "AbortError");
  } catch {
    const error = new Error("Operation aborted.");
    error.name = "AbortError";
    return error;
  }
}
