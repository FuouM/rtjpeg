import { CACHE_LIMIT_BYTES, PROCESSED_LIMIT_BYTES } from "../runtime/constants";
import type { ProcessedFrame, RawFrame } from "../runtime/types";
import { PresentationPtsModel } from "./presentationPts";

export interface FrameCacheDeps {
  getVideoDuration(): number;
  getOfflineFpsFallback(): number;
  getDetectedVideoFps(): number | null;
  /** When sample count / PTS basis changes and non-empty raw cache was cleared. */
  onSlotBasisInvalidated(): void;
  /** If true, idle processed-cache clear is skipped. */
  shouldDeferProcessedCacheClear(): boolean;
  /** FPS estimate for timeline / known frame count fallback. */
  getEstimatedTimelineFps(): number;
  getVideoCurrentTime(): number;
  getTimelineDisplayFps(): number;
}

/**
 * GPU raw-frame cache (per presentation slot) + processed-frame LRU keyed by raw index.
 * Presentation times from the container drive slot indices when available.
 */
export class FrameCache {
  private readonly presentation = new PresentationPtsModel();

  /** Presentation-order raw frames; array index === discrete frame index (0…n−1). */
  private readonly rawFrames: RawFrame[] = [];
  private readonly rawFrameSlotMap = new Map<number, RawFrame>();
  private readonly rawFrameSlotIndexMap = new Map<number, number>();
  private readonly coveredFrameSlots = new Set<number>();
  private rawCacheByteCount = 0;
  private rawFrameSlotBasisTotal: number | null = null;

  // Keyed by frame index (0, 1, 2…). Map preserves insertion order for O(1) LRU.
  private readonly processedFrameMap = new Map<number, ProcessedFrame>();
  private currentProcessedBytes = 0;
  private processedCacheIdleClearId:
    | ReturnType<typeof requestIdleCallback>
    | ReturnType<typeof setTimeout>
    | null = null;

  private readonly deps: FrameCacheDeps;

  constructor(deps: FrameCacheDeps) {
    this.deps = deps;
  }

  get presentationTimesSorted(): Float64Array | null {
    return this.presentation.sortedSamples;
  }

  setPresentationTimesSorted(v: Float64Array | null): void {
    this.presentation.setSortedSamples(v);
  }

  get rawFramesList(): readonly RawFrame[] {
    return this.rawFrames;
  }

  get processedFrames(): Map<number, ProcessedFrame> {
    return this.processedFrameMap;
  }

  get currentCacheBytes(): number {
    return this.rawCacheByteCount;
  }

  /**
   * Window for treating two uploads as the same frame (rVFC jitter, ghost vs element).
   * Capped so a wrong FPS estimate cannot merge consecutive real frames.
   */
  rawFrameTimeEpsilon(): number {
    const fps =
      this.deps.getDetectedVideoFps() ?? this.deps.getOfflineFpsFallback();
    return Math.min(0.45 / Math.max(fps, 1), 0.001);
  }

  /** One slot per MP4 sample row when PTS metadata exists. */
  exactTotalFrameCount(): number | null {
    return this.presentation.sampleCount();
  }

  syncRawFrameSlotBasis(): void {
    const exactTotal = this.exactTotalFrameCount();
    if (this.rawFrameSlotBasisTotal === exactTotal) return;
    this.rawFrameSlotBasisTotal = exactTotal;
    if (this.rawFrames.length > 0) {
      this.clearRawFrameCache();
      this.clearProcessedCache();
      this.deps.onSlotBasisInvalidated();
    }
  }

  /**
   * Presentation sample index for time `t` when PTS metadata exists — same index as white ticks.
   */
  uniformFrameSlotAtTime(t: number): number | null {
    return this.presentation.slotAtTime(t, this.deps.getVideoDuration());
  }

  /** Actual container PTS for sample `slot` when metadata exists; else evenly spaced fallback. */
  uniformTimelineTimeForSlot(slot: number): number | null {
    return this.presentation.timeForSlot(slot, this.deps.getVideoDuration());
  }

  rawFrameAtSlot(slot: number): RawFrame | null {
    return this.rawFrameSlotMap.get(slot) ?? null;
  }

  rawFrameIndexAtSlot(slot: number): number | null {
    return this.rawFrameSlotIndexMap.get(slot) ?? null;
  }

  hasExactCachedFrameAtTime(t: number): boolean {
    const slot = this.uniformFrameSlotAtTime(t);
    return slot !== null && this.rawFrameAtSlot(slot) !== null;
  }

  /**
   * True when the media element is already at the scrub target (same decoded frame / timeline slot).
   */
  scrubReleaseAlreadyAtTarget(targetTime: number): boolean {
    const videoTime = this.deps.getVideoCurrentTime();
    if (Math.abs(videoTime - targetTime) <= 0.0005) return true;
    const slotT = this.uniformFrameSlotAtTime(targetTime);
    const slotV = this.uniformFrameSlotAtTime(videoTime);
    if (slotT !== null && slotV !== null && slotT === slotV) return true;
    const dur = this.deps.getVideoDuration();
    if (dur > 0 && isFinite(dur)) {
      const frameDur = 1 / this.deps.getTimelineDisplayFps();
      if (Math.abs(videoTime - targetTime) <= frameDur * 0.55) return true;
    }
    return false;
  }

  /** Find the active frame index (floor: last frame where time <= t). */
  indexFromTime(t: number, tolerance = 0.5): number | null {
    if (this.rawFrames.length === 0) return null;
    let lo = 0;
    let hi = this.rawFrames.length - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >>> 1;
      if (this.rawFrames[mid].time <= t) lo = mid + 1;
      else hi = mid - 1;
    }
    const bestIdx = lo - 1;
    if (bestIdx < 0) return 0;

    if (Math.abs(this.rawFrames[bestIdx].time - t) > tolerance) return null;
    return bestIdx;
  }

  clearRawFrameCache(): void {
    for (const f of this.rawFrames) f.texture.destroy();
    this.rawFrames.length = 0;
    this.rawFrameSlotMap.clear();
    this.rawFrameSlotIndexMap.clear();
    this.coveredFrameSlots.clear();
    this.rawCacheByteCount = 0;
    this.rawFrameSlotBasisTotal = this.exactTotalFrameCount();
  }

  private reindexRawFrameSlots(startIndex: number): void {
    for (let i = startIndex; i < this.rawFrames.length; i++) {
      const slot = this.rawFrames[i].slot;
      if (slot !== null) {
        this.rawFrameSlotIndexMap.set(slot, i);
      }
    }
  }

  private evictRawFrameAt(index: number): void {
    const frame = this.rawFrames[index];
    if (!frame) return;
    frame.texture.destroy();
    this.rawFrames.splice(index, 1);
    this.rawCacheByteCount -= frame.texture.width * frame.texture.height * 4;
    if (frame.slot !== null) {
      this.rawFrameSlotMap.delete(frame.slot);
      this.rawFrameSlotIndexMap.delete(frame.slot);
      this.coveredFrameSlots.delete(frame.slot);
    }
    this.reindexRawFrameSlots(index);
  }

  private rawFrameDistanceFromSlot(
    frame: RawFrame,
    preferredSlot: number,
  ): number {
    if (frame.slot !== null) {
      return Math.abs(frame.slot - preferredSlot);
    }
    const inferredSlot = this.uniformFrameSlotAtTime(frame.time);
    if (inferredSlot === null) return Number.POSITIVE_INFINITY;
    return Math.abs(inferredSlot - preferredSlot);
  }

  private rawFrameEvictionIndex(preferredSlot: number | null): number {
    if (this.rawFrames.length === 0) return -1;
    if (preferredSlot === null) return 0;

    let bestIndex = 0;
    let bestDistance = -1;
    for (let i = 0; i < this.rawFrames.length; i++) {
      const distance = this.rawFrameDistanceFromSlot(
        this.rawFrames[i],
        preferredSlot,
      );
      if (distance > bestDistance) {
        bestDistance = distance;
        bestIndex = i;
      }
    }
    return bestIndex;
  }

  private ensureRawFrameCapacity(
    bytesNeeded: number,
    preferredSlot: number | null,
  ): boolean {
    while (
      this.rawCacheByteCount + bytesNeeded > CACHE_LIMIT_BYTES &&
      this.rawFrames.length > 0
    ) {
      const evictionIndex = this.rawFrameEvictionIndex(preferredSlot);
      if (evictionIndex < 0) break;
      this.evictRawFrameAt(evictionIndex);
    }
    return this.rawCacheByteCount + bytesNeeded <= CACHE_LIMIT_BYTES;
  }

  precacheStride(frameWidth: number, frameHeight: number): number {
    const total = this.exactTotalFrameCount();
    if (!total || total <= 0) return 1;
    const bytesPerFrame = Math.max(1, frameWidth * frameHeight * 4);
    const reservedBytes = Math.floor(CACHE_LIMIT_BYTES * 0.2);
    const sparseBudget = Math.max(
      bytesPerFrame,
      CACHE_LIMIT_BYTES - reservedBytes,
    );
    const maxFrames = Math.max(1, Math.floor(sparseBudget / bytesPerFrame));
    return Math.max(1, Math.ceil(total / maxFrames));
  }

  shouldPrecacheSlot(
    slot: number | null,
    frameWidth: number,
    frameHeight: number,
  ): boolean {
    if (slot === null) return true;
    const total = this.exactTotalFrameCount();
    if (!total || total <= 0) return true;
    const stride = this.precacheStride(frameWidth, frameHeight);
    return slot === 0 || slot === total - 1 || slot % stride === 0;
  }

  /** Insert sorted by presentation time; returns false if duplicate or over budget. */
  insertRawFrame(frame: RawFrame): boolean {
    this.syncRawFrameSlotBasis();
    const slot = this.uniformFrameSlotAtTime(frame.time);
    if (slot !== null && this.rawFrameSlotMap.has(slot)) {
      frame.texture.destroy();
      return false;
    }
    const frameTime =
      slot !== null
        ? (this.uniformTimelineTimeForSlot(slot) ?? frame.time)
        : frame.time;
    const newBytes = frame.texture.width * frame.texture.height * 4;
    if (!this.ensureRawFrameCapacity(newBytes, slot)) {
      frame.texture.destroy();
      return false;
    }

    const eps = this.rawFrameTimeEpsilon();
    let lo = 0;
    let hi = this.rawFrames.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (this.rawFrames[mid].time < frameTime) lo = mid + 1;
      else hi = mid;
    }

    if (lo > 0 && Math.abs(frameTime - this.rawFrames[lo - 1].time) <= eps) {
      frame.texture.destroy();
      return false;
    }
    if (
      lo < this.rawFrames.length &&
      Math.abs(this.rawFrames[lo].time - frameTime) <= eps
    ) {
      frame.texture.destroy();
      return false;
    }

    if (lo < this.rawFrames.length) {
      this.clearProcessedCache();
    }

    this.rawCacheByteCount += newBytes;
    const normalizedFrame = { ...frame, time: frameTime, slot };
    this.rawFrames.splice(lo, 0, normalizedFrame);
    if (slot !== null) {
      this.rawFrameSlotMap.set(slot, normalizedFrame);
      this.coveredFrameSlots.add(slot);
    }
    this.reindexRawFrameSlots(lo);
    return true;
  }

  hasRawSlotCached(slot: number): boolean {
    return this.rawFrameSlotMap.has(slot);
  }

  lookupProcessed(index: number): ProcessedFrame | null {
    const entry = this.processedFrameMap.get(index);
    if (!entry) return null;
    this.processedFrameMap.delete(index);
    this.processedFrameMap.set(index, entry);
    return entry;
  }

  private evictProcessedLRU(neededBytes: number): void {
    while (
      this.currentProcessedBytes + neededBytes > PROCESSED_LIMIT_BYTES &&
      this.processedFrameMap.size > 0
    ) {
      const [lruKey, evicted] = this.processedFrameMap.entries().next().value!;
      evicted.texture.destroy();
      this.currentProcessedBytes -= evicted.bytes;
      this.processedFrameMap.delete(lruKey);
    }
  }

  insertProcessedFrame(frame: ProcessedFrame): void {
    if (this.processedFrameMap.has(frame.index)) {
      frame.texture.destroy();
      return;
    }
    this.evictProcessedLRU(frame.bytes);
    if (this.currentProcessedBytes + frame.bytes <= PROCESSED_LIMIT_BYTES) {
      this.processedFrameMap.set(frame.index, frame);
      this.currentProcessedBytes += frame.bytes;
    } else {
      frame.texture.destroy();
    }
  }

  /** Pre-evict processed LRU to make room before allocating a new processed texture. */
  evictProcessedLRUForInsert(bytesNeeded: number): void {
    this.evictProcessedLRU(bytesNeeded);
  }

  get processedBytes(): number {
    return this.currentProcessedBytes;
  }

  private destroyProcessedCacheTextures(): void {
    for (const f of this.processedFrameMap.values()) f.texture.destroy();
    this.processedFrameMap.clear();
    this.currentProcessedBytes = 0;
  }

  private cancelScheduledProcessedCacheClear(): void {
    if (this.processedCacheIdleClearId === null) return;
    if (typeof cancelIdleCallback === "function") {
      cancelIdleCallback(
        this.processedCacheIdleClearId as ReturnType<
          typeof requestIdleCallback
        >,
      );
    } else {
      clearTimeout(
        this.processedCacheIdleClearId as ReturnType<typeof setTimeout>,
      );
    }
    this.processedCacheIdleClearId = null;
  }

  scheduleProcessedCacheClearWhenIdle(): void {
    if (this.processedCacheIdleClearId !== null) return;
    const flush = () => {
      this.processedCacheIdleClearId = null;
      if (this.currentProcessedBytes === 0) return;
      if (this.deps.shouldDeferProcessedCacheClear()) return;
      this.destroyProcessedCacheTextures();
    };
    if (typeof requestIdleCallback === "function") {
      this.processedCacheIdleClearId = requestIdleCallback(flush, {
        timeout: 2000,
      });
    } else {
      this.processedCacheIdleClearId = setTimeout(flush, 0);
    }
  }

  clearProcessedCache(): void {
    this.cancelScheduledProcessedCacheClear();
    this.destroyProcessedCacheTextures();
  }

  knownTotalFrameCount(): number | null {
    const pts = this.presentation.sortedSamples;
    if (pts && pts.length > 0) {
      return pts.length;
    }
    const dur = this.deps.getVideoDuration();
    if (dur > 0 && isFinite(dur)) {
      return Math.max(1, Math.ceil(dur * this.deps.getEstimatedTimelineFps()));
    }
    return this.rawFrames.length > 0 ? this.rawFrames.length : null;
  }

  cachedPresentationSampleCount(): number {
    const a = this.presentation.sortedSamples;
    if (!a || a.length === 0) {
      return this.exactTotalFrameCount()
        ? this.coveredFrameSlots.size
        : this.rawFrames.length;
    }
    let n = 0;
    for (let i = 0; i < a.length; i++) {
      if (this.hasExactCachedFrameAtTime(a[i])) n++;
    }
    return n;
  }

  resetForNewSource(): void {
    this.presentation.clear();
    this.clearRawFrameCache();
    this.clearProcessedCache();
  }

  offlineRenderFrameTotal(): number {
    return this.exactTotalFrameCount() ?? this.rawFrames.length;
  }

  offlineRenderFrameTimeAt(index: number): number {
    const pts = this.presentation.sortedSamples;
    if (pts && index >= 0 && index < pts.length) {
      return pts[index];
    }
    const uniform = this.uniformTimelineTimeForSlot(index);
    if (uniform !== null) return uniform;
    const frame = this.rawFrames[index];
    return frame ? frame.time : 0;
  }

  offlineRenderFrameDurationUs(index: number): number {
    const total = this.offlineRenderFrameTotal();
    const frameTime = this.offlineRenderFrameTimeAt(index);
    let nextTime: number;
    if (index + 1 < total) {
      nextTime = this.offlineRenderFrameTimeAt(index + 1);
    } else {
      const dur = this.deps.getVideoDuration();
      if (dur > 0 && isFinite(dur) && dur > frameTime) {
        nextTime = dur;
      } else {
        nextTime = frameTime + 1.0 / this.deps.getOfflineFpsFallback();
      }
    }
    return Math.max(1, Math.round((nextTime - frameTime) * 1e6));
  }
}
