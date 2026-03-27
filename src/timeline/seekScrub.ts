import { renderLoopMutable } from "../renderer/renderLoop";
import { playbackTiming } from "../renderer/playbackTiming";
import type { FrameCache } from "../video/frameCache";

/** Live seek / scrub UI state shared with timeline, render loop, ghost cache, offline render. */
export const seekScrubState = {
  /** True after scrub release when playback will resume — suppresses redundant `seeked` GPU work. */
  skipProcessedCacheClearOnNextPlay: false,
  isSeeking: false,
  scrubTime: null as number | null,
  /** Upcoming compute renders that should ignore stale previous-frame history after a seek jump. */
  suppressTemporalHistoryRenders: 0,
};

export function bumpDownSuppressTemporalHistoryIfPositive(): void {
  const s = seekScrubState;
  if (s.suppressTemporalHistoryRenders > 0) {
    s.suppressTemporalHistoryRenders -= 1;
  }
}

/** Maps a pointer on `#timeline-canvas` to timeline time in seconds. */
export function timeFromTimelinePointer(
  e: PointerEvent | TouchEvent,
  timelineCanvas: HTMLCanvasElement,
  sourceVideo: HTMLVideoElement,
  isImageSource: () => boolean,
): number {
  if (isImageSource()) return 0;
  const rect = timelineCanvas.getBoundingClientRect();
  const clientX =
    "touches" in e ? e.touches[0].clientX : (e as PointerEvent).clientX;
  const frac = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
  return frac * (sourceVideo.duration || 0);
}

export interface AttachSeekScrubHandlersDeps {
  sourceVideo: HTMLVideoElement;
  timelineCanvas: HTMLCanvasElement;
  seekSlider: HTMLInputElement;
  getFrameCache: () => FrameCache;
  isImageSource: () => boolean;
  isOfflineRendering: () => boolean;
  render: () => void;
  scheduleNextFrame: () => void;
  primePlaybackFrameLoop: () => void;
  drawTimeline: () => void;
  startUILoop: () => void;
  updateTimeDisplayText: () => void;
}

/**
 * `seeked`, timeline pointer scrub, and hidden range keyboard seeks.
 * Call after `sourceVideo` play/pause/timeupdate listeners if those depend on seek state.
 */
export function attachSeekScrubHandlers(
  deps: AttachSeekScrubHandlersDeps,
): void {
  const s = seekScrubState;
  let wasPlayingBeforeSeek = false;
  let timelinePointerDown = false;

  const scheduleScrubPreviewSeek = () => {
    const frameCache = deps.getFrameCache();
    if (!s.isSeeking || s.scrubTime === null || deps.isImageSource()) return;
    const t = s.scrubTime;
    if (frameCache.hasExactCachedFrameAtTime(t)) {
      deps.render();
      deps.drawTimeline();
      deps.startUILoop();
      return;
    }
    if (Math.abs(deps.sourceVideo.currentTime - t) <= 0.0005) {
      deps.render();
      deps.drawTimeline();
      deps.startUILoop();
      return;
    }
    deps.sourceVideo.currentTime = t;
    deps.render();
    deps.drawTimeline();
    deps.startUILoop();
  };

  const finalizeCommittedSeek = (committedMediaTime?: number | null) => {
    s.isSeeking = false;
    s.scrubTime = null;
    s.suppressTemporalHistoryRenders = Math.max(
      s.suppressTemporalHistoryRenders,
      2,
    );
    if (committedMediaTime != null && Number.isFinite(committedMediaTime)) {
      playbackTiming.lastMediaTime = committedMediaTime;
    } else {
      playbackTiming.lastMediaTime = deps.sourceVideo.currentTime;
    }
    playbackTiming.lastMediaTimestamp = performance.now();
    const resumePlayback = wasPlayingBeforeSeek && !deps.isOfflineRendering();
    if (resumePlayback) {
      s.skipProcessedCacheClearOnNextPlay = true;
      const playAttempt = deps.sourceVideo.play();
      void playAttempt.catch(() => {
        s.skipProcessedCacheClearOnNextPlay = false;
        deps.render();
      });
      renderLoopMutable.lastNonRvfcPlaybackGpuWallMs = 0;
      renderLoopMutable.lastGpuSubmittedPresentedFrames = null;
      deps.render();
      void playAttempt.then(() => {
        deps.primePlaybackFrameLoop();
      });
    }
    deps.drawTimeline();
    deps.startUILoop();
    if (!resumePlayback) {
      deps.render();
    }
  };

  const handlePointerDown = () => {
    s.isSeeking = true;
    wasPlayingBeforeSeek = !deps.sourceVideo.paused;
    deps.sourceVideo.pause();
  };

  const finishSeek = () => {
    if (!s.isSeeking) return;

    const targetTime = s.scrubTime;
    if (targetTime !== null) {
      if (!deps.getFrameCache().scrubReleaseAlreadyAtTarget(targetTime)) {
        deps.sourceVideo.currentTime = targetTime;
      }
      finalizeCommittedSeek(targetTime);
      return;
    }
    s.isSeeking = false;
    s.scrubTime = null;
    if (wasPlayingBeforeSeek && !deps.isOfflineRendering()) {
      s.skipProcessedCacheClearOnNextPlay = true;
      const playAttempt = deps.sourceVideo.play();
      void playAttempt.catch(() => {
        s.skipProcessedCacheClearOnNextPlay = false;
      });
      void playAttempt.then(() => {
        deps.primePlaybackFrameLoop();
      });
      deps.primePlaybackFrameLoop();
    }
  };

  deps.sourceVideo.addEventListener("seeked", () => {
    const ct = deps.sourceVideo.currentTime;
    const prev = playbackTiming.lastMediaTime;
    playbackTiming.lastMediaTime = ct;
    playbackTiming.lastMediaTimestamp = performance.now();
    // `finalizeCommittedSeek` already drew the timeline at the committed scrub time; when `seeked`
    // lands with essentially the same clock, a second drawTimeline/startUILoop tick fights the
    // playhead and reads as jitter.
    const meaningfulClockChange =
      Math.abs(ct - prev) > 1e-4 || deps.sourceVideo.paused;
    if (meaningfulClockChange) {
      deps.drawTimeline();
      deps.startUILoop();
    }
    if (deps.sourceVideo.paused) {
      deps.render();
    } else if (!renderLoopMutable.isRenderScheduled) {
      deps.scheduleNextFrame();
    }
  });

  const onTimelinePointerDown = (e: PointerEvent) => {
    if (deps.isImageSource()) return;
    e.preventDefault();
    deps.timelineCanvas.setPointerCapture(e.pointerId);
    timelinePointerDown = true;
    handlePointerDown();
    s.scrubTime = timeFromTimelinePointer(
      e,
      deps.timelineCanvas,
      deps.sourceVideo,
      deps.isImageSource,
    );
    deps.drawTimeline();
    deps.updateTimeDisplayText();
    scheduleScrubPreviewSeek();
  };

  const onTimelinePointerMove = (e: PointerEvent) => {
    if (deps.isImageSource()) return;
    if (!timelinePointerDown) return;
    e.preventDefault();
    s.scrubTime = timeFromTimelinePointer(
      e,
      deps.timelineCanvas,
      deps.sourceVideo,
      deps.isImageSource,
    );
    deps.drawTimeline();
    deps.updateTimeDisplayText();
    scheduleScrubPreviewSeek();
  };

  const onTimelinePointerUp = () => {
    if (!timelinePointerDown) return;
    timelinePointerDown = false;
    finishSeek();
    deps.drawTimeline();
  };

  deps.timelineCanvas.addEventListener("pointerdown", onTimelinePointerDown);
  deps.timelineCanvas.addEventListener("pointermove", onTimelinePointerMove);
  deps.timelineCanvas.addEventListener("pointerup", onTimelinePointerUp);
  deps.timelineCanvas.addEventListener("pointercancel", onTimelinePointerUp);

  deps.seekSlider.addEventListener("input", (e) => {
    if (deps.isImageSource()) return;
    const val = parseFloat((e.target as HTMLInputElement).value);
    if (deps.sourceVideo.duration) {
      const t = (val / 100) * deps.sourceVideo.duration;
      s.scrubTime = t;
      deps.startUILoop();
      deps.updateTimeDisplayText();
      scheduleScrubPreviewSeek();
    }
  });
}
