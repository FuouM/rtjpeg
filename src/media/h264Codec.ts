/**
 * H.264 Annex A level limits (frame size in macroblocks, macroblock processing rate).
 * `avc1.42001f` (level 3.1) only allows ~1280×720; 1080p+ needs a higher level or strict decoders fail.
 */
const H264_LEVEL_STEPS: {
  levelIdc: number;
  maxFrameMbs: number;
  maxMbsPerSec: number;
}[] = [
  { levelIdc: 30, maxFrameMbs: 810, maxMbsPerSec: 40500 },
  { levelIdc: 31, maxFrameMbs: 3600, maxMbsPerSec: 108000 },
  { levelIdc: 32, maxFrameMbs: 5120, maxMbsPerSec: 216000 },
  { levelIdc: 40, maxFrameMbs: 8192, maxMbsPerSec: 245760 },
  { levelIdc: 41, maxFrameMbs: 8192, maxMbsPerSec: 245760 },
  { levelIdc: 42, maxFrameMbs: 8704, maxMbsPerSec: 522240 },
  { levelIdc: 50, maxFrameMbs: 22080, maxMbsPerSec: 589824 },
  { levelIdc: 51, maxFrameMbs: 36864, maxMbsPerSec: 983040 },
  { levelIdc: 52, maxFrameMbs: 36864, maxMbsPerSec: 2073600 },
];

function avc1BaselineCodecCandidates(
  width: number,
  height: number,
  fps: number,
): string[] {
  const mbW = Math.ceil(width / 16);
  const mbH = Math.ceil(height / 16);
  const frameMbs = mbW * mbH;
  const mbps = frameMbs * Math.max(1, fps);
  const startIdx = H264_LEVEL_STEPS.findIndex(
    (s) => frameMbs <= s.maxFrameMbs && mbps <= s.maxMbsPerSec,
  );
  const idx = startIdx === -1 ? H264_LEVEL_STEPS.length - 1 : startIdx;
  return H264_LEVEL_STEPS.slice(idx).map(
    (s) => `avc1.4200${s.levelIdc.toString(16).padStart(2, "0")}`,
  );
}

function avccToUint8(description: AllowSharedBufferSource): Uint8Array {
  if (description instanceof ArrayBuffer) return new Uint8Array(description);
  if (
    typeof SharedArrayBuffer !== "undefined" &&
    description instanceof SharedArrayBuffer
  ) {
    return new Uint8Array(description);
  }
  const v = description as ArrayBufferView;
  return new Uint8Array(v.buffer, v.byteOffset, v.byteLength);
}

/** ISO 14496-15 AVCDecoderConfigurationRecord bytes 1–3 → `avc1.PPCCLL` (must match stsd for strict decoders). */
function avc1CodecStringFromAvcc(
  description: AllowSharedBufferSource,
): string | null {
  const d = avccToUint8(description);
  if (d.length < 4 || d[0] !== 1) return null;
  const hex = (n: number) => n.toString(16).padStart(2, "0");
  return `avc1.${hex(d[1])}${hex(d[2])}${hex(d[3])}`;
}

function normalizeAvcEncodedVideoChunkMeta(
  meta: EncodedVideoChunkMetadata | undefined,
): EncodedVideoChunkMetadata | undefined {
  if (!meta?.decoderConfig) return meta;
  const dc = meta.decoderConfig;
  if (!dc.codec.startsWith("avc1") || !dc.description) return meta;
  const fromAvcc = avc1CodecStringFromAvcc(dc.description);
  if (!fromAvcc || fromAvcc === dc.codec) return meta;
  return {
    ...meta,
    decoderConfig: { ...dc, codec: fromAvcc },
  };
}

export async function pickSupportedAvc1BaselineCodec(
  config: Omit<VideoEncoderConfig, "codec">,
): Promise<string> {
  const fps =
    typeof config.framerate === "number" &&
    Number.isFinite(config.framerate) &&
    config.framerate > 0
      ? config.framerate
      : 30;
  for (const codec of avc1BaselineCodecCandidates(
    config.width,
    config.height,
    fps,
  )) {
    const { supported } = await VideoEncoder.isConfigSupported({
      ...config,
      codec,
    });
    if (supported) return codec;
  }
  throw new Error("This browser cannot encode H.264 MP4 at the selected size.");
}

/**
 * Prefer software H.264 encoding when the browser allows it: hardware encoders
 * often ignore baseline profile hints, which breaks playback on strict decoders
 * (some mobile players, in-app browsers, older TV boxes).
 */
export async function configureVideoEncoderForMp4(
  encoder: VideoEncoder,
  base: Omit<VideoEncoderConfig, "codec">,
): Promise<void> {
  const codec = await pickSupportedAvc1BaselineCodec(base);
  const withCodec: VideoEncoderConfig = { ...base, codec };
  const preferSoftware: VideoEncoderConfig = {
    ...withCodec,
    hardwareAcceleration: "prefer-software",
  };
  const { supported } = await VideoEncoder.isConfigSupported(preferSoftware);
  encoder.configure(supported ? preferSoftware : withCodec);
}

type MediabunnyModule = typeof import("mediabunny");

export interface Mp4VideoMuxer {
  addVideoChunk: (
    chunk: EncodedVideoChunk,
    meta?: EncodedVideoChunkMetadata,
  ) => void;
  finalize: () => Promise<void>;
  target: { buffer: ArrayBuffer | null };
}

let mediabunnyModPromise: Promise<MediabunnyModule> | null = null;

async function loadMediabunny(): Promise<MediabunnyModule> {
  return (mediabunnyModPromise ??= import("mediabunny"));
}

export async function createMp4Muxer(config: {
  fps?: number;
  width: number;
  height: number;
}): Promise<Mp4VideoMuxer> {
  const {
    BufferTarget,
    EncodedPacket,
    EncodedVideoPacketSource,
    Mp4OutputFormat,
    Output,
  } = await loadMediabunny();

  const target = new BufferTarget();
  const output = new Output({
    format: new Mp4OutputFormat({ fastStart: "in-memory" }),
    target,
  });
  const videoSource = new EncodedVideoPacketSource("avc");

  if (config.fps != null && Number.isFinite(config.fps) && config.fps > 0) {
    // Only declare a track frame rate for true CFR exports. Mediabunny snaps
    // timestamps/durations to this rate, which breaks source PTS preservation.
    output.addVideoTrack(videoSource, {
      frameRate: config.fps,
    });
  } else {
    output.addVideoTrack(videoSource);
  }
  await output.start();

  let firstChunkTimestamp: number | null = null;
  let writeError: unknown = null;
  let pendingWrite = Promise.resolve();

  return {
    addVideoChunk(chunk, meta) {
      pendingWrite = pendingWrite.then(async () => {
        if (writeError) return;

        try {
          const packet = EncodedPacket.fromEncodedChunk(chunk);
          if (firstChunkTimestamp === null)
            firstChunkTimestamp = chunk.timestamp;

          // Mirror mp4-muxer's "offset" timestamp behavior so files start at t=0.
          const normalizedPacket =
            firstChunkTimestamp === 0
              ? packet
              : packet.clone({
                  timestamp:
                    (chunk.timestamp - firstChunkTimestamp) / 1_000_000,
                });

          await videoSource.add(
            normalizedPacket,
            normalizeAvcEncodedVideoChunkMeta(meta),
          );
        } catch (error) {
          writeError = error;
        }
      });
    },
    async finalize() {
      await pendingWrite;
      if (writeError) throw writeError;
      videoSource.close();
      await output.finalize();
    },
    target,
  };
}
