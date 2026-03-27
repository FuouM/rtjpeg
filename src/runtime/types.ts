import type { Mp4VideoMuxer } from "../media/h264Codec";

export type BarcodeDetectorCtor = new (options: { formats: string[] }) => {
  detect(image: ImageBitmapSource): Promise<Array<{ rawValue: string }>>;
};

export type SourceKind = "video" | "image";

export type LiveExportFormat = "webm" | "mp4";

export interface LiveExportSession {
  format: LiveExportFormat;
  fps: number;
  width: number;
  height: number;
  exportCanvas: HTMLCanvasElement;
  exportCtx: CanvasRenderingContext2D;
  sourceStream: MediaStream | null;
  mirrorVideo: HTMLVideoElement | null;
  stream: MediaStream | null;
  streamTrack: CanvasCaptureMediaStreamTrack | null;
  mediaRecorder: MediaRecorder | null;
  recordedChunks: Blob[];
  mp4Encoder: VideoEncoder | null;
  mp4Muxer: Mp4VideoMuxer | null;
  frameInterval: number | null;
  statusInterval: number | null;
  recordingStartTime: number;
  frameCount: number;
}

export interface RawFrame {
  time: number;
  texture: GPUTexture;
  view: GPUTextureView;
  slot: number | null;
}

export interface ProcessedFrame {
  index: number;
  time: number;
  texture: GPUTexture;
  view: GPUTextureView;
  bindGroup: GPUBindGroup;
  bytes: number;
}
