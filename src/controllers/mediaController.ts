import { type AppDom } from "../appShell";
import { mediaState } from "../state/mediaState";
import { type GhostCacheDeps } from "../video/ghostCache";
import {
  attachVideoUploadChangeHandler,
  attachVideoUploadDropZone,
  clearVideoSrcRevokeOwned,
  setVideoSrcWithOwnedUrl,
  type VideoUploadPipelineDeps,
} from "../source";

const DEBUG_MEDIA_LOGS = import.meta.env.DEV;

export interface MediaControllerDeps {
  dom: AppDom;
  useCanvasVideoSource: boolean;
  videoUploadCanvas: HTMLCanvasElement;
  videoUploadCanvasCtx: CanvasRenderingContext2D | null;
  onClearOfflineRenderingIfNeeded: () => void;
  onResetRenderButtonState: () => void;
  onSetCacheStatusText: (text: string) => void;
  onDrawTimeline: () => void;
  onResetRenderLoopState: () => void;
  onResetFrameCacheAndGhost: () => void;
  getGhostCacheDeps: () => GhostCacheDeps;
  setWelcomeSampleOverlayVisible: (v: boolean) => void;
  onRender: () => void;
  onResizeCanvasToVideo: () => void;
  defaultCacheText: string;
  cancelImageFrameRequest: () => void;
  isImageFrameRequestPending: () => boolean;
  onComparisonSourceImage?: (src: string) => void;
  onClearComparisonSourceImage?: () => void;
  onComparisonAfterMediaChange?: () => void;
}

export function setupMediaController(deps: MediaControllerDeps) {
  const { dom } = deps;

  function isImageSource(): boolean {
    return (
      mediaState.currentSourceKind === "image" &&
      mediaState.sourceImage !== null
    );
  }

  function activeSourceWidth(): number {
    return isImageSource()
      ? mediaState.sourceImage!.naturalWidth
      : dom.sourceVideo.videoWidth;
  }

  function activeSourceHeight(): number {
    return isImageSource()
      ? mediaState.sourceImage!.naturalHeight
      : dom.sourceVideo.videoHeight;
  }

  function activeSourceTime(): number {
    return isImageSource() ? 0 : dom.sourceVideo.currentTime;
  }

  function activeCopySource():
    | HTMLVideoElement
    | HTMLImageElement
    | HTMLCanvasElement
    | null {
    if (isImageSource()) return mediaState.sourceImage;
    if (dom.sourceVideo.readyState < 2) return null;
    if (!deps.useCanvasVideoSource || !deps.videoUploadCanvasCtx)
      return dom.sourceVideo;

    const width = dom.sourceVideo.videoWidth;
    const height = dom.sourceVideo.videoHeight;
    if (width <= 0 || height <= 0) return null;

    if (
      deps.videoUploadCanvas.width !== width ||
      deps.videoUploadCanvas.height !== height
    ) {
      deps.videoUploadCanvas.width = width;
      deps.videoUploadCanvas.height = height;
    }

    if (DEBUG_MEDIA_LOGS && !mediaState.loggedCanvasVideoFallback) {
      console.info("[rtjpeg] using canvas-backed video upload path");
      mediaState.loggedCanvasVideoFallback = true;
    }

    try {
      deps.videoUploadCanvasCtx.drawImage(dom.sourceVideo, 0, 0, width, height);
      return deps.videoUploadCanvas;
    } catch (error) {
      console.warn(
        "Could not draw the current video frame to the staging canvas.",
        error,
      );
      return null;
    }
  }

  function setSourceVideoUrl(url: string, ownsObjectUrl = false): void {
    setVideoSrcWithOwnedUrl(
      dom.sourceVideo,
      url,
      ownsObjectUrl,
      mediaState.ownedVideoUrlRef,
    );
  }

  function clearSourceVideoUrl(): void {
    clearVideoSrcRevokeOwned(dom.sourceVideo, mediaState.ownedVideoUrlRef);
  }

  function updateSourceModeUI(): void {
    const imageMode = isImageSource();
    if (!imageMode && deps.isImageFrameRequestPending()) {
      deps.cancelImageFrameRequest();
    }
    dom.renderBtn.disabled = false;
    dom.renderBtn.style.opacity = "1";
    dom.renderBtn.style.cursor = "pointer";
    dom.renderBtn.title = imageMode
      ? "Save the current processed image"
      : "Render full video with current settings";
    dom.renderBtn.textContent = imageMode ? "SAVE IMAGE" : "RENDER";

    dom.playPauseBtn.disabled = imageMode;
    dom.seekSlider.disabled = imageMode;
    dom.timelineCanvas.style.cursor = imageMode ? "default" : "pointer";

    if (imageMode) {
      dom.playPauseBtn.textContent = "IMAGE";
    } else {
      dom.playPauseBtn.textContent = dom.sourceVideo.paused ? "PLAY" : "PAUSE";
    }
  }

  function resetSelectedMediaState(): void {
    deps.onResetFrameCacheAndGhost();
    deps.onDrawTimeline();
    deps.onSetCacheStatusText(deps.defaultCacheText);
    mediaState.detectedVideoFps = null;
    mediaState.offlineFps = 30;
    deps.onResetRenderLoopState();

    mediaState.currentSourceKind = "video";
    mediaState.sourceImage = null;
    clearSourceVideoUrl();
    deps.onClearComparisonSourceImage?.();
    deps.onComparisonAfterMediaChange?.();
  }

  const videoUploadPipelineDeps: VideoUploadPipelineDeps = {
    videoUpload: dom.videoUpload,
    sourceVideo: dom.sourceVideo,
    getUserMediaEpoch: () => mediaState.userMediaChoiceEpoch,
    onUserChoseFile: () => {
      mediaState.userMediaChoiceEpoch += 1;
    },
    getUploadPreparationAbort: () =>
      mediaState.uploadPreparationAbortController,
    setUploadPreparationAbort: (c: AbortController | null) => {
      mediaState.uploadPreparationAbortController = c;
    },
    setUploadTranscodeProgress: (p: number | null) => {
      mediaState.uploadTranscodeTimelineProgress = p;
    },
    resetSelectedMediaState,
    clearOfflineRenderingIfNeeded: deps.onClearOfflineRenderingIfNeeded,
    resetRenderButtonState: deps.onResetRenderButtonState,
    updateSourceModeUI,
    setCacheStatusText: deps.onSetCacheStatusText,
    drawTimeline: deps.onDrawTimeline,
    setWelcomeSampleOverlayVisible: deps.setWelcomeSampleOverlayVisible,
    ghostCacheDeps: deps.getGhostCacheDeps(),
    defaultCacheText: deps.defaultCacheText,
    render: deps.onRender,
    resizeCanvasToVideo: deps.onResizeCanvasToVideo,
    assignVideoUrl: setSourceVideoUrl,
    onImageDecoded: (img: HTMLImageElement) => {
      mediaState.sourceImage = img;
      mediaState.currentSourceKind = "image";
      dom.sourceVideo.pause();
      clearSourceVideoUrl();
      updateSourceModeUI();
      deps.onResizeCanvasToVideo();
      deps.onRender();
      deps.onComparisonSourceImage?.(img.currentSrc || img.src);
      deps.onComparisonAfterMediaChange?.();
    },
    onBeginVideoFilePipeline: () => {
      mediaState.currentSourceKind = "video";
      mediaState.sourceImage = null;
      clearSourceVideoUrl();
      deps.onClearComparisonSourceImage?.();
      updateSourceModeUI();
      deps.onComparisonAfterMediaChange?.();
    },
  };

  attachVideoUploadChangeHandler(videoUploadPipelineDeps);
  attachVideoUploadDropZone(
    dom.headerVideoUploadDropzone,
    videoUploadPipelineDeps,
  );
  attachVideoUploadDropZone(dom.welcomeUploadDropzone, videoUploadPipelineDeps);

  return {
    isImageSource,
    activeSourceWidth,
    activeSourceHeight,
    activeSourceTime,
    activeCopySource,
    setSourceVideoUrl,
    updateSourceModeUI,
    resetSelectedMediaState,
  };
}
