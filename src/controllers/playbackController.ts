import { engineState } from "../state/engineState";
import { resetFrameStepChain, seekScrubState } from "../timeline/seekScrub";
import { renderLoopMutable } from "../renderer/renderLoop";

export interface PlaybackControllerDeps {
  sourceVideo: HTMLVideoElement;
  playPauseBtn: HTMLButtonElement;
  refreshMoshBtn: HTMLButtonElement;
  isImageSource: () => boolean;
  clearProcessedCache: () => void;
  render: () => void;
  drawTimeline: () => void;
  updateTimeDisplayText: () => void;
  startUILoop: () => void;
  hasProcessedBytes: () => boolean;
}

export function setupPlaybackController(deps: PlaybackControllerDeps) {
  const {
    sourceVideo,
    playPauseBtn,
    refreshMoshBtn,
    isImageSource,
    clearProcessedCache,
    render,
    drawTimeline,
    updateTimeDisplayText,
    startUILoop,
    hasProcessedBytes,
  } = deps;

  refreshMoshBtn.addEventListener("click", () => {
    engineState.moshResetRequested = true;
    render();
  });

  playPauseBtn.addEventListener("click", () => {
    if (isImageSource()) return;
    if (sourceVideo.paused) sourceVideo.play();
    else sourceVideo.pause();
  });

  sourceVideo.addEventListener("play", () => {
    resetFrameStepChain();
    playPauseBtn.textContent = "PAUSE";
    const skipClear = seekScrubState.skipProcessedCacheClearOnNextPlay;
    seekScrubState.skipProcessedCacheClearOnNextPlay = false;
    // Clearing the full processed cache on every play() makes scrub-and-resume hitch badly
    // (full compute for the next frames). Skip once when resuming after a timeline scrub.
    if (hasProcessedBytes() && !skipClear) {
      clearProcessedCache();
    }

    render();
  });

  sourceVideo.addEventListener("pause", () => {
    playPauseBtn.textContent = "PLAY";
    renderLoopMutable.isRenderScheduled = false;
    renderLoopMutable.lastGpuSubmittedPresentedFrames = null;
    renderLoopMutable.lastNonRvfcPlaybackGpuWallMs = 0;
    // Timeline scrub sets isSeeking before pause(); skipping cancel keeps the RVFC registration
    // path warmer so play()→first frame is less likely to stall after release.
    if (
      !seekScrubState.isSeeking &&
      renderLoopMutable.videoFrameRequestHandle != null &&
      "cancelVideoFrameCallback" in sourceVideo
    ) {
      (
        sourceVideo as HTMLVideoElement & {
          cancelVideoFrameCallback: (h: number) => void;
        }
      ).cancelVideoFrameCallback(renderLoopMutable.videoFrameRequestHandle);
      renderLoopMutable.videoFrameRequestHandle = undefined;
    }
    drawTimeline();
  });

  sourceVideo.addEventListener("timeupdate", () => {
    if (
      sourceVideo.duration &&
      !seekScrubState.isSeeking &&
      !sourceVideo.seeking
    ) {
      startUILoop();
    }
  });

  sourceVideo.addEventListener("loadedmetadata", () => {
    if (sourceVideo.duration) {
      updateTimeDisplayText();
    }
  });
}
