import type { GhostCacheDeps } from "../video/ghostCache";
import { startGhostCache } from "../video/ghostCache";

const DEBUG_MEDIA_LOGS = import.meta.env.DEV;

export interface ApplyDefaultSampleVideoDeps {
  useCanvasVideoSource: boolean;
  sampleVideoUrl: string;
  defaultCacheText: string;
  getUserMediaEpoch: () => number;
  /** `currentSourceKind = "video"` and `sourceImage = null` */
  setSourceKindVideoClearImage: () => void;
  setCacheStatusText: (message: string) => void;
  setTranscodeProgress: (progress: number | null) => void;
  drawTimeline: () => void;
  assignVideoUrl: (url: string, ownsObjectUrl: boolean) => void;
  updateSourceModeUI: () => void;
  sourceVideo: HTMLVideoElement;
  ghostCacheDeps: GhostCacheDeps;
}

/**
 * Loads the bundled sample after explicit user action (Try example).
 * Canvas-transcode path runs FFmpeg; direct path sets a static URL.
 */
export async function applyDefaultSampleVideo(
  baselineEpoch: number,
  deps: ApplyDefaultSampleVideoDeps,
): Promise<boolean> {
  let applied = false;
  try {
    deps.setSourceKindVideoClearImage();
    if (deps.useCanvasVideoSource) {
      const response = await fetch(deps.sampleVideoUrl, {
        cache: "force-cache",
      });
      const blob = await response.blob();
      if (deps.getUserMediaEpoch() !== baselineEpoch) {
        return false;
      }
      if (DEBUG_MEDIA_LOGS) {
        console.info("[rtjpeg] preparing default sample through ffmpeg.wasm");
      }
      deps.setCacheStatusText("Preparing sample video...");
      const sampleFile = new File([blob], "cat_full.mp4", {
        type: blob.type || "video/mp4",
        lastModified: Date.now(),
      });
      const { prepareVideoUpload } = await import("../video/videoTranscoder");
      try {
        const preparedSample = await prepareVideoUpload(sampleFile, {
          onStatus: (message) => deps.setCacheStatusText(message),
          onTranscodeProgress: (p) => {
            deps.setTranscodeProgress(p);
            deps.drawTimeline();
          },
        });
        if (deps.getUserMediaEpoch() === baselineEpoch) {
          deps.assignVideoUrl(URL.createObjectURL(preparedSample.blob), true);
          deps.setCacheStatusText(deps.defaultCacheText);
          applied = true;
        }
      } finally {
        deps.setTranscodeProgress(null);
        deps.drawTimeline();
      }
    } else if (deps.getUserMediaEpoch() === baselineEpoch) {
      deps.assignVideoUrl(deps.sampleVideoUrl, false);
      applied = true;
    }
  } catch (e) {
    console.warn("Failed to attach sample video", e);
    if (deps.getUserMediaEpoch() === baselineEpoch) {
      deps.setSourceKindVideoClearImage();
      deps.assignVideoUrl(deps.sampleVideoUrl, false);
      applied = true;
    }
  }
  if (applied) {
    deps.updateSourceModeUI();
    void startGhostCache(deps.sourceVideo.src, false, deps.ghostCacheDeps);
  }
  return applied;
}
