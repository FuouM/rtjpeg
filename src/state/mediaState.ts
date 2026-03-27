import type { SourceKind } from "../runtime/types";
import type { OwnedObjectUrlRef } from "../source";

export const mediaState = {
  currentSourceKind: "video" as SourceKind,
  sourceImage: null as HTMLImageElement | null,

  /** Incremented on every file-picker choice so async default sample load cannot clobber user media. */
  userMediaChoiceEpoch: 0,

  ownedVideoUrlRef: { current: null } as OwnedObjectUrlRef,
  uploadPreparationAbortController: null as AbortController | null,

  /** 0–100 ffmpeg encode progress for the timeline bar; null when idle. */
  uploadTranscodeTimelineProgress: null as number | null,

  loggedCanvasVideoFallback: false,

  offlineFps: 30, // Default fps fallback
  detectedVideoFps: null as number | null,
};
