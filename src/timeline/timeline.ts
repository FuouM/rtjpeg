import type { ProcessedFrame, RawFrame } from "../runtime/types";
import { lastSampleIndexAtOrBefore } from "../video/presentationPts";

export interface TimelineDeps {
  timeDisplay: HTMLElement;
  timelineCanvas: HTMLCanvasElement;
  timelineCtx: CanvasRenderingContext2D;
  get sourceVideo(): HTMLVideoElement;
  isImageSource: () => boolean;
  get uploadTranscodeTimelineProgress(): number | null;
  get isOfflineRendering(): boolean;
  get offlineRenderHeadTimeForUi(): number;
  get isSeeking(): boolean;
  get scrubTime(): number | null;
  get lastMediaTime(): number;
  get lastMediaTimestamp(): number;
  get rawFrames(): readonly RawFrame[];
  get processedFrameMap(): Map<number, ProcessedFrame>;
  uniformFrameSlotAtTime: (t: number) => number | null;
  uniformTimelineTimeForSlot: (slot: number) => number | null;
  rawFrameTimeEpsilon: () => number;
  get detectedVideoFPS(): number | null;
  get OFFLINE_FPS(): number;
  /** Every sample composition time from the container (sorted), one entry per decoded frame. */
  get videoAllPresentationTimesSorted(): Float64Array | null;
  /** True when a raw GPU cache entry exists for this PTS (uses main’s slot lookup). */
  hasExactCachedFrameAtTime: (t: number) => boolean;
}

let isUILoopRunning = false;
let scheduledTimelineFrameId: number | null = null;
let scheduledTimelineDeps: TimelineDeps | null = null;

function pixelColumnForTime(
  t: number,
  duration: number,
  width: number,
): number {
  if (width <= 1 || duration <= 0 || !isFinite(duration)) return 0;
  const normalized = Math.max(0, Math.min(1, t / duration));
  return Math.max(0, Math.min(width - 1, Math.round(normalized * (width - 1))));
}

function drawBucketRuns(
  ctx: CanvasRenderingContext2D,
  buckets: Uint8Array,
  height: number,
  uncachedColor: string,
  cachedColor?: string,
): void {
  let runState = 0;
  let runStart = 0;
  for (let i = 0; i <= buckets.length; i++) {
    const nextState = i < buckets.length ? buckets[i] : 0;
    if (nextState === runState) continue;
    if (runState !== 0) {
      ctx.fillStyle =
        runState === 2 && cachedColor !== undefined
          ? cachedColor
          : uncachedColor;
      ctx.fillRect(runStart, 0, i - runStart, height);
    }
    runState = nextState;
    runStart = i;
  }
}

function scheduleTimelineFrame(deps: TimelineDeps): void {
  scheduledTimelineDeps = deps;
  if (scheduledTimelineFrameId !== null) return;
  scheduledTimelineFrameId = requestAnimationFrame(() => {
    scheduledTimelineFrameId = null;
    const activeDeps = scheduledTimelineDeps;
    if (!activeDeps) return;
    drawTimeline(activeDeps);
    const video = activeDeps.sourceVideo;
    if (
      isUILoopRunning &&
      (!video.paused || activeDeps.isSeeking || video.seeking)
    ) {
      scheduleTimelineFrame(activeDeps);
    } else {
      isUILoopRunning = false;
    }
  });
}

export function timelineDisplayFps(deps: TimelineDeps): number {
  return Math.max(1, deps.detectedVideoFPS ?? deps.OFFLINE_FPS);
}

function snapHeadTimeToTimelineGrid(deps: TimelineDeps, t: number): number {
  if (deps.isImageSource()) return t;
  const dur = deps.sourceVideo.duration;
  if (!dur || !isFinite(dur) || dur <= 0) return t;
  const clamped = Math.max(0, Math.min(t, dur));
  const allPts = deps.videoAllPresentationTimesSorted;
  if (allPts && allPts.length > 0) {
    const idx = lastSampleIndexAtOrBefore(allPts, clamped);
    const pt = allPts[idx];
    return Math.max(0, Math.min(pt, dur));
  }
  const slot = deps.uniformFrameSlotAtTime(clamped);
  const fps = timelineDisplayFps(deps);
  if (slot !== null) {
    const st = deps.uniformTimelineTimeForSlot(slot);
    if (st !== null) return Math.max(0, Math.min(st, dur));
  }
  const maxIdx = Math.max(0, Math.ceil(dur * fps) - 1);
  const frameIdx = Math.min(maxIdx, Math.floor(clamped * fps));
  return Math.min(dur, frameIdx / fps);
}

function currentHeadTimeForUI(deps: TimelineDeps): number {
  if (deps.isImageSource()) return 0;
  if (deps.isOfflineRendering) {
    const dur = deps.sourceVideo.duration;
    if (!dur || !isFinite(dur)) return deps.offlineRenderHeadTimeForUi;
    return Math.max(0, Math.min(deps.offlineRenderHeadTimeForUi, dur));
  }
  let headTime: number;
  if (deps.isSeeking && deps.scrubTime !== null) {
    headTime = deps.scrubTime;
  } else if (deps.sourceVideo.seeking) {
    headTime = deps.lastMediaTime;
  } else {
    headTime = deps.sourceVideo.currentTime;
  }
  if (
    !deps.isSeeking &&
    !deps.sourceVideo.paused &&
    deps.sourceVideo.playbackRate !== 0 &&
    !deps.sourceVideo.seeking
  ) {
    const now = performance.now();
    const elapsed = (now - deps.lastMediaTimestamp) / 1000;
    const interpolated =
      deps.lastMediaTime + elapsed * deps.sourceVideo.playbackRate;
    const dur = deps.sourceVideo.duration;
    if (dur > 0 && isFinite(dur)) {
      headTime = ((interpolated % dur) + dur) % dur;
    } else {
      headTime = interpolated;
    }
  }
  return snapHeadTimeToTimelineGrid(deps, headTime);
}

function formatMediaClock(seconds: number, minuteFieldWidth: number): string {
  if (isNaN(seconds) || !isFinite(seconds)) {
    return `${String(0).padStart(minuteFieldWidth, " ")}:00`;
  }
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${String(m).padStart(minuteFieldWidth, " ")}:${s
    .toString()
    .padStart(2, "0")}`;
}

function formatTimeDisplayWithFrames(
  deps: TimelineDeps,
  t: number,
  duration: number,
): string {
  const minuteFieldWidth = Math.max(
    1,
    String(Math.floor(Math.max(0, duration) / 60)).length,
    String(Math.floor(Math.max(0, t) / 60)).length,
  );
  const clock = `${formatMediaClock(t, minuteFieldWidth)} / ${formatMediaClock(
    duration,
    minuteFieldWidth,
  )}`;
  const fps = timelineDisplayFps(deps);
  let curFrame: number;
  let totalFrames: number;

  const allPts = deps.videoAllPresentationTimesSorted;
  if (allPts && allPts.length > 0) {
    totalFrames = allPts.length;
    const idx = lastSampleIndexAtOrBefore(allPts, Math.max(0, t));
    curFrame = idx + 1;
  } else {
    const raw = deps.rawFrames;
    const cachedIdx =
      raw.length > 0
        ? indexFromTime(
            raw,
            Math.max(0, t),
            Math.max(deps.rawFrameTimeEpsilon() * 2, 0.05),
          )
        : null;
    curFrame =
      cachedIdx !== null ? cachedIdx + 1 : Math.floor(Math.max(0, t) * fps) + 1;
    totalFrames =
      duration > 0 && isFinite(duration)
        ? Math.max(1, Math.ceil(duration * fps))
        : 1;
  }

  const frameW = Math.max(
    1,
    String(totalFrames).length,
    String(curFrame).length,
  );

  if (!duration || !isFinite(duration) || duration <= 0) {
    return `${clock}  ·  ${String(curFrame).padStart(frameW, "0")}`;
  }
  const c = Math.min(curFrame, totalFrames);
  return `${clock}  ·  ${String(c).padStart(frameW, "0")} / ${String(
    totalFrames,
  ).padStart(frameW, "0")}`;
}

/**
 * Next / previous timeline frame time (container PTS when present, else FPS grid — not raw cache).
 * Stepping past the last frame wraps to the first; before the first wraps to the last.
 * @param baseTimeOverride When set (rapid frame-step burst), step from this time instead of
 *   currentHeadTimeForUI — avoids keyframe-snapped `video.currentTime` repeating the same index.
 * Returns null for images, offline render, or unknown duration.
 */
export function stepFrameTime(
  deps: TimelineDeps,
  direction: -1 | 1,
  baseTimeOverride?: number,
): number | null {
  if (deps.isImageSource() || deps.isOfflineRendering) return null;
  const dur = deps.sourceVideo.duration;
  if (!dur || !isFinite(dur) || dur <= 0) return null;

  const t =
    baseTimeOverride !== undefined &&
    Number.isFinite(baseTimeOverride) &&
    baseTimeOverride >= 0
      ? Math.min(baseTimeOverride, dur)
      : currentHeadTimeForUI(deps);
  const allPts = deps.videoAllPresentationTimesSorted;
  if (allPts && allPts.length > 0) {
    const n = allPts.length;
    const idx = lastSampleIndexAtOrBefore(allPts, Math.max(0, t));
    let nextIdx = idx + direction;
    if (nextIdx < 0) nextIdx = n - 1;
    else if (nextIdx >= n) nextIdx = 0;
    return Math.max(0, Math.min(allPts[nextIdx], dur));
  }

  // No container PTS: step on the same FPS grid as snapHeadTimeToTimelineGrid — never limit to
  // GPU raw-cache indices (cache is partial; video seek must reach every frame).
  const fps = timelineDisplayFps(deps);
  const clamped = Math.max(0, Math.min(t, dur));
  const maxIdx = Math.max(0, Math.ceil(dur * fps) - 1);
  const frameIdx = Math.min(maxIdx, Math.floor(clamped * fps));
  let nextFrame = frameIdx + direction;
  if (nextFrame < 0) nextFrame = maxIdx;
  else if (nextFrame > maxIdx) nextFrame = 0;
  return Math.min(dur, nextFrame / fps);
}

function indexFromTime(
  rawFrames: readonly RawFrame[],
  t: number,
  tolerance = 0.5,
): number | null {
  if (rawFrames.length === 0) return null;
  let lo = 0,
    hi = rawFrames.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >>> 1;
    if (rawFrames[mid].time <= t) lo = mid + 1;
    else hi = mid - 1;
  }
  const bestIdx = lo - 1;
  if (bestIdx < 0) return 0;

  if (Math.abs(rawFrames[bestIdx].time - t) > tolerance) return null;
  return bestIdx;
}

export function updateTimeDisplayText(deps: TimelineDeps): void {
  if (deps.isImageSource()) {
    deps.timeDisplay.textContent = "IMAGE  ·  LIVE";
    return;
  }
  const dur = deps.sourceVideo.duration;
  if (!dur || !isFinite(dur)) {
    const ct = deps.sourceVideo.currentTime;
    const minuteFieldWidth = Math.max(
      1,
      String(Math.floor(Math.max(0, ct) / 60)).length,
    );
    deps.timeDisplay.textContent = `${formatMediaClock(
      ct,
      minuteFieldWidth,
    )} / ${formatMediaClock(0, minuteFieldWidth)}  ·  —`;
    return;
  }
  const t = Math.max(0, Math.min(currentHeadTimeForUI(deps), dur));
  deps.timeDisplay.textContent = formatTimeDisplayWithFrames(deps, t, dur);
}

export function drawTimeline(deps: TimelineDeps): void {
  const dur = deps.sourceVideo.duration;
  const dpr = window.devicePixelRatio || 1;
  const cssW = deps.timelineCanvas.clientWidth;
  const cssH = deps.timelineCanvas.clientHeight;
  const pw = Math.round(cssW * dpr);
  const ph = Math.round(cssH * dpr);

  if (deps.timelineCanvas.width !== pw || deps.timelineCanvas.height !== ph) {
    deps.timelineCanvas.width = pw;
    deps.timelineCanvas.height = ph;
  }

  const ctx = deps.timelineCtx;
  const isDark = document.documentElement.classList.contains("dark");

  ctx.fillStyle = isDark ? "#222" : "#ccc";
  ctx.fillRect(0, 0, pw, ph);

  if (deps.isImageSource()) {
    ctx.fillStyle = isDark ? "rgba(46,255,70,0.28)" : "rgba(21,128,61,0.24)";
    ctx.fillRect(0, 0, pw, ph);
    updateTimeDisplayText(deps);
    return;
  }

  if (!dur) {
    const p = deps.uploadTranscodeTimelineProgress;
    if (p !== null) {
      const overlayW = (Math.max(0, Math.min(100, p)) / 100) * pw;
      ctx.fillStyle = isDark
        ? "rgba(251, 191, 36, 0.4)"
        : "rgba(217, 119, 6, 0.38)";
      ctx.fillRect(0, 0, overlayW, ph);
      ctx.strokeStyle = isDark
        ? "rgba(251, 191, 36, 0.55)"
        : "rgba(180, 83, 9, 0.45)";
      ctx.lineWidth = 1 * dpr;
      ctx.strokeRect(0.5 * dpr, 0.5 * dpr, pw - dpr, ph - dpr);
    }
    updateTimeDisplayText(deps);
    return;
  }

  const stripeW = Math.max(1, Math.floor(1 * dpr));
  const allPts = deps.videoAllPresentationTimesSorted;
  const rawFrames = deps.rawFrames;

  if (allPts && allPts.length > 0) {
    const buckets = new Uint8Array(pw);
    for (let i = 0; i < allPts.length; i++) {
      buckets[pixelColumnForTime(allPts[i], dur, pw)] = 1;
    }
    for (let i = 0; i < rawFrames.length; i++) {
      const frame = rawFrames[i];
      const sampleTime =
        frame.slot !== null
          ? (deps.uniformTimelineTimeForSlot(frame.slot) ?? frame.time)
          : frame.time;
      buckets[pixelColumnForTime(sampleTime, dur, pw)] = 2;
    }
    drawBucketRuns(
      ctx,
      buckets,
      ph,
      isDark ? "rgba(255,255,255,0.10)" : "rgba(0,0,0,0.10)",
      isDark ? "rgba(255,255,255,0.32)" : "rgba(0,0,0,0.26)",
    );
  } else {
    const buckets = new Uint8Array(pw);
    for (let i = 0; i < rawFrames.length; i++) {
      buckets[pixelColumnForTime(rawFrames[i].time, dur, pw)] = 1;
    }
    drawBucketRuns(
      ctx,
      buckets,
      ph,
      isDark ? "rgba(255,255,255,0.25)" : "rgba(0,0,0,0.18)",
    );
  }

  // Slot is presentation sample index; `uniformTimelineTimeForSlot` is container PTS for that index.
  const inset = 3 * dpr;
  ctx.fillStyle = isDark ? "rgba(0,255,100,0.60)" : "rgba(0,200,80,0.55)";
  for (const frame of deps.processedFrameMap.values()) {
    const raw =
      frame.index >= 0 && frame.index < rawFrames.length
        ? rawFrames[frame.index]
        : undefined;
    const slot =
      raw?.slot != null ? raw.slot : deps.uniformFrameSlotAtTime(frame.time);
    let tDraw = frame.time;
    if (slot !== null) {
      const st = deps.uniformTimelineTimeForSlot(slot);
      if (st !== null) tDraw = st;
    }
    const x = (tDraw / dur) * pw;
    ctx.fillRect(x - stripeW / 2, inset, stripeW, ph - inset * 2);
  }

  const headTime = currentHeadTimeForUI(deps);
  const headX = (headTime / dur) * pw;
  ctx.fillStyle = isDark ? "rgba(255,255,255,0.05)" : "rgba(0,0,0,0.05)";
  ctx.fillRect(0, 0, headX, ph);

  const lineW = Math.max(1, 1 * dpr);
  ctx.fillStyle = isDark ? "#ffffff" : "#000000";
  ctx.fillRect(headX - lineW / 2, 0, lineW, ph);

  const d = 5 * dpr;
  ctx.save();
  ctx.translate(headX, ph * 0.5);
  ctx.beginPath();
  ctx.moveTo(0, -d);
  ctx.lineTo(d, 0);
  ctx.lineTo(0, d);
  ctx.lineTo(-d, 0);
  ctx.closePath();
  ctx.fillStyle = isDark ? "#2eff46" : "#15803d";
  ctx.strokeStyle = isDark ? "#000" : "#fff";
  ctx.lineWidth = 1.5 * dpr;
  ctx.fill();
  ctx.stroke();
  ctx.restore();

  updateTimeDisplayText(deps);
}

export function updateCacheCanvas(deps: TimelineDeps): void {
  scheduleTimelineFrame(deps);
}

export function startUILoop(deps: TimelineDeps): void {
  if (isUILoopRunning) return;
  isUILoopRunning = true;
  scheduleTimelineFrame(deps);
}
