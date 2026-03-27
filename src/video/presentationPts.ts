/**
 * Container presentation timestamps (sorted composition times from MP4 stbl) and
 * slot/time mapping — one logical slot per sample row when metadata exists.
 */

/** Last index i with pts[i] <= t (sorted PTS). Empty array yields -1. */
export function lastSampleIndexAtOrBefore(
  pts: Float64Array,
  t: number,
): number {
  const n = pts.length;
  if (n === 0) return -1;
  let lo = 0;
  let hi = n - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >>> 1;
    if (pts[mid] <= t) lo = mid + 1;
    else hi = mid - 1;
  }
  return Math.max(0, hi);
}

/**
 * Holds sorted MP4 sample PTS and maps wall-clock time ↔ uniform slot index.
 * Does not own GPU state — only timing metadata and math.
 */
export class PresentationPtsModel {
  private samples: Float64Array | null = null;

  /** Sorted composition times (seconds), one per stbl sample, or null before metadata loads. */
  get sortedSamples(): Float64Array | null {
    return this.samples;
  }

  setSortedSamples(v: Float64Array | null): void {
    this.samples = v;
  }

  clear(): void {
    this.samples = null;
  }

  /** Sample count when PTS table exists; otherwise null (no uniform grid from container). */
  sampleCount(): number | null {
    const a = this.samples;
    return a && a.length > 0 ? a.length : null;
  }

  /**
   * Presentation sample index for time `t` — aligns with white timeline ticks when PTS exists.
   * Without PTS, returns null (no discrete basis).
   */
  slotAtTime(t: number, durationSec: number): number | null {
    if (!durationSec || !isFinite(durationSec) || durationSec <= 0) return null;
    const clamped = Math.max(0, Math.min(t, durationSec));
    const pts = this.samples;
    if (pts && pts.length > 0) {
      return lastSampleIndexAtOrBefore(pts, clamped);
    }
    const total = this.sampleCount();
    if (!total || total <= 0) return null;
    return Math.min(total - 1, Math.floor((clamped / durationSec) * total));
  }

  /** Container PTS for sample index `slot`, or evenly spaced fallback when no PTS table. */
  timeForSlot(slot: number, durationSec: number): number | null {
    const total = this.sampleCount();
    if (
      !total ||
      total <= 0 ||
      !durationSec ||
      !isFinite(durationSec) ||
      durationSec <= 0
    )
      return null;
    const clampedSlot = Math.max(0, Math.min(slot, total - 1));
    const pts = this.samples;
    if (pts && pts.length > 0) {
      return Math.max(0, Math.min(pts[clampedSlot], durationSec));
    }
    if (total === 1) return 0;
    return (clampedSlot / (total - 1)) * durationSec;
  }
}
