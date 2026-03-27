import { MAX_USER_MEDIA_FILE_BYTES } from "../runtime/constants";
import type { GhostCacheDeps } from "../video/ghostCache";
import { startGhostCache } from "../video/ghostCache";

const DEBUG_MEDIA_LOGS = import.meta.env.DEV;

export interface VideoUploadPipelineDeps {
  videoUpload: HTMLInputElement;
  sourceVideo: HTMLVideoElement;
  getUserMediaEpoch: () => number;
  /** Only when a file is present: hide welcome overlay and bump epoch. */
  onUserChoseFile: () => void;
  getUploadPreparationAbort: () => AbortController | null;
  setUploadPreparationAbort: (c: AbortController | null) => void;
  setUploadTranscodeProgress: (p: number | null) => void;
  resetSelectedMediaState: () => void;
  clearOfflineRenderingIfNeeded: () => void;
  resetRenderButtonState: () => void;
  updateSourceModeUI: () => void;
  setCacheStatusText: (t: string) => void;
  drawTimeline: () => void;
  setWelcomeSampleOverlayVisible: (visible: boolean) => void;
  ghostCacheDeps: GhostCacheDeps;
  defaultCacheText: string;
  render: () => void;
  resizeCanvasToVideo: () => void;
  assignVideoUrl: (url: string, ownsObjectUrl: boolean) => void;
  onImageDecoded: (img: HTMLImageElement) => void;
  /** Before FFmpeg transcode: video mode, drop image, clear element url. */
  onBeginVideoFilePipeline: () => void;
}

/**
 * Shared path for header file input, welcome drop zone, etc.
 */
export async function runVideoUploadPipeline(
  file: File | undefined,
  deps: VideoUploadPipelineDeps,
): Promise<void> {
  if (file) {
    if (file.size > MAX_USER_MEDIA_FILE_BYTES) {
      alert(
        "This file is larger than 1 GB. Use a shorter or lower-resolution clip for in-browser processing.",
      );
      return;
    }
    deps.setWelcomeSampleOverlayVisible(false);
    deps.onUserChoseFile();
  }
  const selectionEpoch = deps.getUserMediaEpoch();
  deps.getUploadPreparationAbort()?.abort();
  deps.setUploadPreparationAbort(null);

  deps.resetSelectedMediaState();
  deps.clearOfflineRenderingIfNeeded();
  deps.resetRenderButtonState();
  deps.updateSourceModeUI();

  if (!file) return;

  if (file.type.startsWith("image/")) {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      deps.onImageDecoded(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      console.error("Failed to load image upload.");
    };
    img.src = url;
    return;
  }

  deps.onBeginVideoFilePipeline();
  const transcodeController = new AbortController();
  deps.setUploadPreparationAbort(transcodeController);

  try {
    if (DEBUG_MEDIA_LOGS) {
      console.info("[rtjpeg] upload selected, preparing transcoded source", {
        name: file.name,
        type: file.type,
        size: file.size,
      });
    }
    deps.setCacheStatusText("Preparing upload...");
    const { prepareVideoUpload } = await import("../video/videoTranscoder");
    const preparedVideo = await prepareVideoUpload(file, {
      signal: transcodeController.signal,
      onStatus: (message) => deps.setCacheStatusText(message),
      onTranscodeProgress: (p) => {
        deps.setUploadTranscodeProgress(p);
        deps.drawTimeline();
      },
    });
    if (selectionEpoch !== deps.getUserMediaEpoch()) return;

    const playbackUrl = URL.createObjectURL(preparedVideo.blob);
    deps.setCacheStatusText(deps.defaultCacheText);
    deps.assignVideoUrl(playbackUrl, true);
    deps.sourceVideo.play().catch(() => {});
    startGhostCache(playbackUrl, true, deps.ghostCacheDeps);
  } catch (error) {
    if ((error as Error).name === "AbortError") return;
    console.error("Failed to prepare uploaded video.", error);
    deps.setCacheStatusText(deps.defaultCacheText);
    alert(
      (error as Error).message || "Could not prepare this video for playback.",
    );
  } finally {
    if (deps.getUploadPreparationAbort() === transcodeController) {
      deps.setUploadPreparationAbort(null);
    }
    deps.setUploadTranscodeProgress(null);
    deps.drawTimeline();
  }
}

function isLikelyUploadableFile(file: File): boolean {
  if (file.type.startsWith("image/") || file.type.startsWith("video/")) {
    return true;
  }
  if (file.type) return false;
  return /\.(mp4|webm|mov|m4v|mkv|avi|gif|png|jpe?g|webp)$/i.test(file.name);
}

/**
 * Drag-and-drop onto a region (header picker, welcome overlay, etc.); same pipeline as `#video-upload` change.
 */
export function attachVideoUploadDropZone(
  dropZone: HTMLElement,
  deps: VideoUploadPipelineDeps,
): void {
  let dragDepth = 0;

  dropZone.addEventListener("dragenter", (e) => {
    e.preventDefault();
    if (!e.dataTransfer?.types.includes("Files")) return;
    dragDepth += 1;
    if (dragDepth === 1) dropZone.classList.add("video-upload-drag-over");
  });

  dropZone.addEventListener("dragleave", (e) => {
    e.preventDefault();
    dragDepth -= 1;
    if (dragDepth <= 0) {
      dragDepth = 0;
      dropZone.classList.remove("video-upload-drag-over");
    }
  });

  dropZone.addEventListener("dragover", (e) => {
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
  });

  dropZone.addEventListener("drop", (e) => {
    e.preventDefault();
    dragDepth = 0;
    dropZone.classList.remove("video-upload-drag-over");
    const file = e.dataTransfer?.files?.[0];
    if (!file || !isLikelyUploadableFile(file)) return;
    void runVideoUploadPipeline(file, deps);
  });
}

/**
 * File input → image decode or ffmpeg transcode → `video.src` + ghost cache.
 */
export function attachVideoUploadChangeHandler(
  deps: VideoUploadPipelineDeps,
): void {
  deps.videoUpload.addEventListener("change", async (e) => {
    const file = (e.target as HTMLInputElement).files?.[0];
    deps.videoUpload.value = "";
    await runVideoUploadPipeline(file, deps);
  });
}
