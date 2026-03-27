import type { Mp4VideoMuxer } from "../media/h264Codec";
import type { RawFrame } from "../runtime/types";

/**
 * Bridges offline WebCodecs MP4 encode to `main.ts` timeline, GPU render, and raw-cache lookups.
 */
export interface OfflineRenderDeps {
  get isOfflineRendering(): boolean;
  setIsOfflineRendering: (v: boolean) => void;
  get offlineFrameCount(): number;
  setOfflineFrameCount: (n: number) => void;
  get offlineRenderHeadTimeForUi(): number;
  setOfflineRenderHeadTimeForUi: (t: number) => void;
  get offlineEncoder(): VideoEncoder | null;
  get offlineMuxer(): Mp4VideoMuxer | null;
  get sourceVideo(): HTMLVideoElement;
  get outputCanvas(): HTMLCanvasElement;
  get renderBtn(): HTMLButtonElement;
  get OFFLINE_FPS(): number;
  offlineRenderFrameTotal: () => number;
  offlineRenderFrameTimeAt: (index: number) => number;
  offlineRenderFrameDurationUs: (index: number) => number;
  uniformFrameSlotAtTime: (t: number) => number | null;
  rawFrameAtSlot: (slot: number) => RawFrame | null;
  render: () => void;
  drawTimeline: () => void;
  get isSeeking(): boolean;
  setIsSeeking: (v: boolean) => void;
  get scrubTime(): number | null;
  setScrubTime: (v: number | null) => void;
  isImageSource: () => boolean;
  activeSourceWidth: () => number;
  activeSourceHeight: () => number;
  activeCopySource: () =>
    | HTMLVideoElement
    | HTMLCanvasElement
    | HTMLImageElement
    | null;
}

export async function seekSourceVideoForOfflineFrame(
  video: HTMLVideoElement,
  targetTime: number,
): Promise<void> {
  if (Math.abs(video.currentTime - targetTime) <= 0.0005) return;
  await new Promise<void>((resolve) => {
    const onSeeked = () => {
      video.removeEventListener("seeked", onSeeked);
      resolve();
    };
    video.addEventListener("seeked", onSeeked, { once: true });
    video.currentTime = targetTime;
  });
}

/**
 * After seek, `seeked` can fire before HAVE_CURRENT_DATA or before drawImage/copyExternalImage
 * can sample the target frame — `render()` then bails with !canRender and we would encode a stale canvas.
 *
 * Intentionally does NOT use requestVideoFrameCallback: that waits for the *next* composited video
 * frame (~16–40ms per seek) and dominated uncached offline render time. Polling readyState +
 * activeCopySource is enough for WebGPU copyExternalImageToTexture.
 */
export async function waitForVideoPaintableForOffline(
  deps: OfflineRenderDeps,
): Promise<void> {
  if (deps.isImageSource()) return;
  const video = deps.sourceVideo;
  const deadline = performance.now() + 5000;
  while (performance.now() < deadline) {
    if (video.seeking) {
      await Promise.race([
        new Promise<void>((resolve) => {
          video.addEventListener("seeked", () => resolve(), { once: true });
        }),
        new Promise<void>((resolve) => setTimeout(resolve, 400)),
      ]);
      continue;
    }
    if (
      video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA &&
      deps.activeSourceWidth() > 0 &&
      deps.activeSourceHeight() > 0 &&
      deps.activeCopySource() !== null
    ) {
      return;
    }
    await new Promise((r) => requestAnimationFrame(r));
  }
}

export function finalizeOfflineRender(deps: OfflineRenderDeps): void {
  deps.setIsOfflineRendering(false);
  deps.renderBtn.textContent = "⚙️ Finalizing…";
  const enc = deps.offlineEncoder;
  const mux = deps.offlineMuxer;
  if (!enc || !mux) return;
  enc.flush().then(async () => {
    await mux.finalize();
    const buffer = mux.target.buffer;
    if (!buffer) throw new Error("Could not finalize the offline MP4 render.");
    let blob = new Blob([buffer], { type: "video/mp4" });
    try {
      const { transcodeExportMp4ForDevicePlayback } =
        await import("./videoTranscoder");
      blob = await transcodeExportMp4ForDevicePlayback(blob, {
        onStatus: (msg) => {
          deps.renderBtn.textContent = `⚙️ ${msg}`;
        },
      });
    } catch (err) {
      console.warn(
        "[rtjpeg] MP4 finalize (ffmpeg) failed; saving raw WebCodecs output.",
        err,
      );
    }
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.style.display = "none";
    a.href = url;
    a.download = `rtjpeg_render_${Date.now()}.mp4`;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }, 100);

    deps.renderBtn.textContent = "RENDER VIDEO";
    deps.renderBtn.style.backgroundColor = "#00e5ff";
    deps.renderBtn.style.color = "black";
  });
}

/**
 * Offline render loop — iterates by frame index so the output contains
 * exactly N frames with their original PTS.
 */
export async function processOfflineFrame(
  deps: OfflineRenderDeps,
): Promise<void> {
  if (!deps.isOfflineRendering) return;

  const totalFrames = deps.offlineRenderFrameTotal();
  if (deps.offlineFrameCount >= totalFrames) {
    finalizeOfflineRender(deps);
    return;
  }

  const frameTime = deps.offlineRenderFrameTimeAt(deps.offlineFrameCount);
  deps.setOfflineRenderHeadTimeForUi(frameTime);
  const cacheSlot = deps.uniformFrameSlotAtTime(frameTime);
  const exactCachedFrame =
    cacheSlot !== null ? deps.rawFrameAtSlot(cacheSlot) : null;
  if (!exactCachedFrame) {
    await seekSourceVideoForOfflineFrame(deps.sourceVideo, frameTime);
    await waitForVideoPaintableForOffline(deps);
  }

  const prevIsSeeking = deps.isSeeking;
  const prevScrubTime = deps.scrubTime;
  deps.setIsSeeking(true);
  deps.setScrubTime(frameTime);
  deps.render();
  deps.setIsSeeking(prevIsSeeking);
  deps.setScrubTime(prevScrubTime);

  const durationUs = deps.offlineRenderFrameDurationUs(deps.offlineFrameCount);

  try {
    const vf = new VideoFrame(deps.outputCanvas, {
      timestamp: Math.round(frameTime * 1e6),
      duration: durationUs,
    });
    try {
      deps.offlineEncoder!.encode(vf, {
        keyFrame:
          deps.offlineFrameCount % Math.max(1, Math.round(deps.OFFLINE_FPS)) ===
          0,
      });
    } finally {
      vf.close();
    }

    deps.setOfflineFrameCount(deps.offlineFrameCount + 1);
    deps.renderBtn.textContent = `⚙️ ${Math.min(
      100,
      Math.floor((deps.offlineFrameCount / totalFrames) * 100),
    )}%`;
    deps.drawTimeline();
  } catch (e) {
    console.error("Frame capture failed:", e);
  }

  const encoder = deps.offlineEncoder;
  if (!encoder) return;

  if (encoder.encodeQueueSize > 8) {
    encoder.addEventListener(
      "dequeue",
      () => {
        void processOfflineFrame(deps);
      },
      { once: true },
    );
  } else if (deps.offlineFrameCount % 50 === 0) {
    setTimeout(() => {
      void processOfflineFrame(deps);
    }, 0);
  } else {
    void processOfflineFrame(deps);
  }
}
