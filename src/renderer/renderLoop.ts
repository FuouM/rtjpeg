import type { GpuContext } from "../gpu/gpuContext";
import { CACHE_LIMIT_BYTES, PROCESSED_LIMIT_BYTES } from "../runtime/constants";
import type { FrameCache } from "../video/frameCache";
import { playbackTiming } from "./playbackTiming";

export const renderLoopMutable = {
  lastParamsFingerprint: Number.NaN,
  globalFrameCount: 0,
  fpsFrameCount: 0,
  fpsLastTick: performance.now(),
  fpsMediaAnchor: null as number | null,
  fpsMediaLast: null as number | null,
  fpsMediaFrameCount: 0,
  isRenderScheduled: false,
  isDisplayingRenderTime: false,
  lastRenderTimeMs: 0,
  /** Pending `requestVideoFrameCallback` id — cancelled on pause so decode callbacks do not touch the GPU. */
  videoFrameRequestHandle: undefined as number | undefined,
  /** Drop duplicate RVFC invocations for the same decoded frame (stacked after scrub / play). */
  lastGpuSubmittedPresentedFrames: null as number | null,
  /** Wall clock for coalescing rAF/non-RVFC GPU submits in the same burst as RVFC. */
  lastNonRvfcPlaybackGpuWallMs: 0,
  imageFrameRequestHandle: undefined as number | undefined,
  lastRenderWasManualCache: false,
};

export interface RenderLoopDeps {
  fpsDisplay: HTMLElement;
  getGpu: () => GpuContext | null;
  ensureGpuReady: () => Promise<boolean>;
  getFrameCache: () => FrameCache;
  sourceVideo: HTMLVideoElement;
  outputCanvas: HTMLCanvasElement;
  useCanvasVideoSource: boolean;
  isImageSource: () => boolean;
  isOfflineRendering: () => boolean;
  getIsSeeking: () => boolean;
  getScrubTime: () => number | null;
  livePlaybackCacheTime: () => number;
  writeParamsBuffer: () => void;
  getParamsFingerprint: () => number;
  shouldUseProcessedFrameCache: () => boolean;
  hasTemporalFeedbackEffects: () => boolean;
  updateCanvasSize: (targetWidth: number, targetHeight: number) => void;
  tryCacheVisibleFrameAtTime: (
    source: HTMLVideoElement | HTMLCanvasElement | HTMLImageElement | null,
    width: number,
    height: number,
    time: number,
  ) => void;
  activeSourceWidth: () => number;
  activeSourceHeight: () => number;
  activeCopySource: () =>
    | HTMLVideoElement
    | HTMLImageElement
    | HTMLCanvasElement
    | null;
  getCurrentScale: () => number;
  bumpDownSuppressTemporalHistoryIfPositive: () => void;
  updateCacheCanvas: () => void;
  updateCacheStatusText: () => void;
}

const NON_RVFC_PLAYBACK_GPU_COALESCE_MS = 6;

export function createRenderLoop(deps: RenderLoopDeps) {
  const m = renderLoopMutable;

  deps.fpsDisplay.style.cursor = "pointer";
  deps.fpsDisplay.title = "Click to toggle between FPS and Frame Render Time";
  deps.fpsDisplay.addEventListener("click", () => {
    m.isDisplayingRenderTime = !m.isDisplayingRenderTime;
    m.fpsFrameCount = 0;
    m.fpsLastTick = 0; // Force immediate update in tickFPS()
    tickFPS();
  });

  function tickFPS() {
    m.fpsFrameCount += 1;
    const now = performance.now();
    const updateFreqMs = m.isDisplayingRenderTime ? 60 : 500;
    if (now - m.fpsLastTick < updateFreqMs) return;

    if (m.isDisplayingRenderTime) {
      deps.fpsDisplay.textContent = `${m.lastRenderTimeMs.toFixed(2)} MS`;
      deps.fpsDisplay.style.color = "#00e5ff"; // Cyan for timing mode
    } else {
      const wallFps = (m.fpsFrameCount / (now - m.fpsLastTick)) * 1000;
      deps.fpsDisplay.textContent = `${Math.round(wallFps)} FPS`;

      let matchesVideo = false;
      if (
        m.fpsMediaFrameCount >= 2 &&
        m.fpsMediaLast != null &&
        m.fpsMediaAnchor != null
      ) {
        const deltaMedia = m.fpsMediaLast - m.fpsMediaAnchor;
        if (deltaMedia > 1e-4) {
          const videoFps = (m.fpsMediaFrameCount - 1) / deltaMedia;
          const tol = Math.max(1.25, videoFps * 0.06);
          matchesVideo = Math.abs(wallFps - videoFps) <= tol;
        }
      }
      deps.fpsDisplay.style.color = matchesVideo ? "#22c55e" : "";
    }
    m.fpsFrameCount = 0;
    m.fpsLastTick = now;
    m.fpsMediaAnchor = null;
    m.fpsMediaLast = null;
    m.fpsMediaFrameCount = 0;
  }

  /** Schedule exactly one next-frame callback when video is playing. */
  function scheduleNextFrame() {
    if (deps.isImageSource() && !m.isRenderScheduled) {
      m.isRenderScheduled = true;
      m.imageFrameRequestHandle = requestAnimationFrame((now) => {
        m.imageFrameRequestHandle = undefined;
        render(now);
      });
      return;
    }

    if (!deps.sourceVideo.paused && !m.isRenderScheduled) {
      m.isRenderScheduled = true;
      if (
        !deps.useCanvasVideoSource &&
        "requestVideoFrameCallback" in deps.sourceVideo
      ) {
        const v = deps.sourceVideo as HTMLVideoElement & {
          requestVideoFrameCallback: (cb: typeof render) => number;
          cancelVideoFrameCallback?: (h: number) => void;
        };
        if (
          m.videoFrameRequestHandle != null &&
          typeof v.cancelVideoFrameCallback === "function"
        ) {
          v.cancelVideoFrameCallback(m.videoFrameRequestHandle);
          m.videoFrameRequestHandle = undefined;
        }
        m.videoFrameRequestHandle = v.requestVideoFrameCallback(render);
      } else {
        requestAnimationFrame(render);
      }
    }
  }

  /** Re-arm RVFC/rAF after play(); browsers often need an extra tick before callbacks resume reliably. */
  function primePlaybackFrameLoop(): void {
    if (deps.isImageSource()) return;
    const kick = () => {
      if (!deps.sourceVideo.paused && !m.isRenderScheduled) scheduleNextFrame();
    };
    kick();
    queueMicrotask(kick);
    requestAnimationFrame(kick);
  }

  /** Suppresses a second queue.submit within a few ms when the callback has no RVFC metadata (rAF stacks). */
  function beginPlaybackGpuBurstCoalesce(
    metadata?: VideoFrameCallbackMetadata,
  ): boolean {
    if (deps.isOfflineRendering() || deps.isImageSource()) return true;
    if (
      deps.sourceVideo.paused ||
      deps.getIsSeeking() ||
      deps.sourceVideo.seeking ||
      m.lastRenderWasManualCache
    )
      return true;
    if (metadata != null) return true;
    const t = performance.now();
    if (
      t - m.lastNonRvfcPlaybackGpuWallMs <
      NON_RVFC_PLAYBACK_GPU_COALESCE_MS
    ) {
      scheduleNextFrame();
      return false;
    }
    m.lastNonRvfcPlaybackGpuWallMs = t;
    return true;
  }

  function render(
    _now?: DOMHighResTimeStamp,
    metadata?: VideoFrameCallbackMetadata,
  ) {
    const startTime = performance.now();
    try {
      m.isRenderScheduled = false;
      if (metadata !== undefined) {
        m.videoFrameRequestHandle = undefined;
      }
      const gpu = deps.getGpu();
      if (!gpu) {
        void deps.ensureGpuReady().then((ready) => {
          if (!ready) return;
          render(_now, metadata);
        });
        return;
      }

      const frameCache = deps.getFrameCache();
      const sourceVideo = deps.sourceVideo;

      // Stray frame callback after pause — skip GPU (cancelVideoFrameCallback is not always immediate).
      if (
        metadata !== undefined &&
        sourceVideo.paused &&
        !deps.getIsSeeking() &&
        !deps.isOfflineRendering()
      ) {
        return;
      }

      // RVFC can fire twice for the same decoded frame after scrub release — same `presentedFrames`.
      if (
        !deps.isOfflineRendering() &&
        !deps.isImageSource() &&
        !sourceVideo.paused &&
        !deps.getIsSeeking() &&
        metadata != null &&
        metadata.presentedFrames !== undefined &&
        m.lastGpuSubmittedPresentedFrames === metadata.presentedFrames
      ) {
        scheduleNextFrame();
        return;
      }

      tickFPS();

      // Sync high-res interpolation state
      if (metadata && !deps.useCanvasVideoSource) {
        playbackTiming.lastMediaTime = metadata.mediaTime;
        playbackTiming.lastMediaTimestamp = performance.now();
      } else if (!deps.isImageSource()) {
        playbackTiming.lastMediaTime = deps.livePlaybackCacheTime();
        playbackTiming.lastMediaTimestamp = performance.now();
      }

      // Detect parameter changes → invalidate processed cache
      const paramsFingerprint = deps.getParamsFingerprint();
      if (paramsFingerprint !== m.lastParamsFingerprint) {
        m.lastParamsFingerprint = paramsFingerprint;
        frameCache.clearProcessedCache();
        m.globalFrameCount = 0;
      }
      if (
        (!deps.shouldUseProcessedFrameCache() ||
          deps.hasTemporalFeedbackEffects()) &&
        frameCache.processedBytes > 0
      ) {
        frameCache.scheduleProcessedCacheClearWhenIdle();
      }

      m.globalFrameCount += 1;
      const sourceWidth = deps.activeSourceWidth();
      const sourceHeight = deps.activeSourceHeight();
      const sourceToCopy = deps.activeCopySource();

      // Opportunistic raw-frame capture during live playback
      const shouldCaptureLiveFrame =
        !sourceVideo.paused &&
        !deps.getIsSeeking() &&
        !deps.isOfflineRendering() &&
        sourceToCopy != null &&
        sourceWidth > 0 &&
        sourceHeight > 0 &&
        (metadata != null || deps.useCanvasVideoSource);

      if (shouldCaptureLiveFrame) {
        if (!sourceVideo.paused && sourceVideo.playbackRate > 0) {
          const mediaTimeForStats = deps.livePlaybackCacheTime();
          if (m.fpsMediaAnchor === null) m.fpsMediaAnchor = mediaTimeForStats;
          m.fpsMediaLast = mediaTimeForStats;
          m.fpsMediaFrameCount += 1;
        }

        const t = deps.livePlaybackCacheTime();
        const slot = frameCache.uniformFrameSlotAtTime(t);
        const shouldInsertSparseFrame =
          frameCache.shouldPrecacheSlot(slot, sourceWidth, sourceHeight) &&
          (slot === null || !frameCache.hasRawSlotCached(slot));
        if (
          shouldInsertSparseFrame &&
          frameCache.currentCacheBytes < CACHE_LIMIT_BYTES
        ) {
          try {
            const tex = gpu.device.createTexture({
              size: [sourceWidth, sourceHeight, 1],
              format: "rgba8unorm",
              usage:
                GPUTextureUsage.TEXTURE_BINDING |
                GPUTextureUsage.COPY_DST |
                GPUTextureUsage.RENDER_ATTACHMENT,
            });
            gpu.device.queue.copyExternalImageToTexture(
              { source: sourceToCopy },
              { texture: tex },
              [sourceWidth, sourceHeight],
            );
            if (
              frameCache.insertRawFrame({
                time: t,
                texture: tex,
                view: tex.createView(),
                slot: null,
              })
            ) {
              deps.updateCacheCanvas();
              deps.updateCacheStatusText();
            }
          } catch {
            /* ignore */
          }
        }
      }

      if (!deps.isImageSource() && sourceVideo.readyState < 1) {
        scheduleNextFrame();
        return;
      }

      let timeToRender = sourceVideo.currentTime;
      const scrubTime = deps.getScrubTime();
      if (deps.getIsSeeking() && scrubTime !== null) {
        timeToRender = scrubTime;
      } else if (sourceVideo.seeking) {
        // If the video is natively seeking, hold the last frame if we don't have a scrubTime
        timeToRender = playbackTiming.lastMediaTime;
      }

      let timeForCache = timeToRender;

      // Determine source frame
      let viewToUse: GPUTextureView | null = null;
      let prevInputView: GPUTextureView | null = null;
      let frameIdx: number | null = null;
      let pulledFromCache = false;
      const desiredSlot = frameCache.uniformFrameSlotAtTime(timeForCache);
      const rawFrames = frameCache.rawFramesList;

      if (
        (sourceVideo.paused ||
          deps.getIsSeeking() ||
          sourceVideo.seeking ||
          sourceVideo.readyState < 2) &&
        rawFrames.length > 0
      ) {
        if (desiredSlot !== null) {
          const exactFrameIndex = frameCache.rawFrameIndexAtSlot(desiredSlot);
          if (exactFrameIndex !== null) {
            const exactFrame = rawFrames[exactFrameIndex];
            frameIdx = exactFrameIndex;
            viewToUse = exactFrame.view;
            timeForCache = exactFrame.time;
            pulledFromCache = true;
            if (frameIdx > 0) {
              const prevFrame = rawFrames[frameIdx - 1];
              if (prevFrame) prevInputView = prevFrame.view;
            }
          }
        } else if (!deps.getIsSeeking()) {
          frameIdx = frameCache.indexFromTime(timeForCache, 0.1);
          if (frameIdx !== null) {
            const frame = rawFrames[frameIdx];
            if (frame) {
              viewToUse = frame.view;
              timeForCache = frame.time;
              pulledFromCache = true;

              if (frameIdx > 0) {
                const prevFrame = rawFrames[frameIdx - 1];
                if (prevFrame) prevInputView = prevFrame.view;
              }
            }
          }
        }
      }

      const canRender =
        viewToUse !== null ||
        (sourceToCopy !== null && sourceWidth > 0 && sourceHeight > 0);
      if (!canRender) {
        scheduleNextFrame();
        return;
      }

      // Snap resolution to 16×16 macroblocks
      const currentScale = deps.getCurrentScale();
      const targetWidth =
        Math.ceil(Math.floor(sourceWidth / currentScale) / 16) * 16;
      const targetHeight =
        Math.ceil(Math.floor(sourceHeight / currentScale) / 16) * 16;
      deps.updateCanvasSize(targetWidth, targetHeight);

      if (!gpu.storageTexture || !gpu.renderBindGroup) {
        scheduleNextFrame();
        return;
      }

      // --- Tier 2: processed frame cache bypass (skipped during offline render for temporal consistency) ---
      if (frameIdx !== null && deps.shouldUseProcessedFrameCache()) {
        const cached = frameCache.lookupProcessed(frameIdx);
        if (cached) {
          if (!beginPlaybackGpuBurstCoalesce(metadata)) return;
          // Params buffer is not used by the render pipeline — no writeBuffer needed here.
          const commandEncoder = gpu.device.createCommandEncoder();
          const passEncoder = commandEncoder.beginRenderPass({
            colorAttachments: [
              {
                view: gpu.context.getCurrentTexture().createView(),
                clearValue: { r: 0, g: 0, b: 0, a: 1 },
                loadOp: "clear",
                storeOp: "store",
              },
            ],
          });
          passEncoder.setPipeline(gpu.renderPipeline);
          passEncoder.setBindGroup(0, cached.bindGroup);
          passEncoder.draw(4);
          passEncoder.end();
          gpu.device.queue.submit([commandEncoder.finish()]);
          if (metadata != null && metadata.presentedFrames !== undefined) {
            m.lastGpuSubmittedPresentedFrames = metadata.presentedFrames;
          }
          m.lastRenderWasManualCache = metadata == null;
          scheduleNextFrame();
          return;
        }
      }

      // --- Full compute + render path ---
      const activePipeline = gpu.computePipeline2D;
      const activeLayout = gpu.computeLayout2D;

      if (!viewToUse && sourceToCopy && sourceWidth > 0 && sourceHeight > 0) {
        if (
          gpu.currInputTexture &&
          (gpu.currInputTexture.width !== sourceWidth ||
            gpu.currInputTexture.height !== sourceHeight)
        ) {
          gpu.currInputTexture.destroy();
          gpu.currInputTexture = null;
          if (gpu.prevInputTexture) {
            gpu.prevInputTexture.destroy();
            gpu.prevInputTexture = null;
          }
          gpu.currInputTextureView = null;
          gpu.prevInputTextureView = null;
        }
        if (!gpu.currInputTexture) {
          const texDesc = {
            size: [sourceWidth, sourceHeight, 1] as GPUExtent3DStrict,
            format: "rgba8unorm" as GPUTextureFormat,
            usage:
              GPUTextureUsage.TEXTURE_BINDING |
              GPUTextureUsage.COPY_DST |
              GPUTextureUsage.RENDER_ATTACHMENT,
          };
          gpu.currInputTexture = gpu.device.createTexture(texDesc);
          gpu.prevInputTexture = gpu.device.createTexture(texDesc);
          gpu.currInputTextureView = gpu.currInputTexture.createView();
          gpu.prevInputTextureView = gpu.prevInputTexture.createView();
          gpu.device.queue.copyExternalImageToTexture(
            { source: sourceToCopy },
            { texture: gpu.prevInputTexture },
            [sourceWidth, sourceHeight],
          );
        }
        gpu.device.queue.copyExternalImageToTexture(
          { source: sourceToCopy },
          { texture: gpu.currInputTexture },
          [sourceWidth, sourceHeight],
        );
        viewToUse = gpu.currInputTextureView!;
        prevInputView = gpu.prevInputTextureView!;
        if (sourceVideo.paused || deps.getIsSeeking() || sourceVideo.seeking) {
          deps.tryCacheVisibleFrameAtTime(
            sourceToCopy,
            sourceWidth,
            sourceHeight,
            timeForCache,
          );
        }
      }

      if (!viewToUse) {
        scheduleNextFrame();
        return;
      }

      // After scrub release, keep the last good frame on screen until the decoder lands.
      // Rendering from the live element while native seeking is still in flight can flash
      // a darker transitional frame even when temporal effects are disabled.
      // When paused (frame step / keyboard), allow the pipeline to run so uncached seeks can
      // resolve; seeked will refine once the decoder finishes.
      if (
        !deps.isImageSource() &&
        sourceVideo.seeking &&
        !deps.getIsSeeking() &&
        !pulledFromCache &&
        !sourceVideo.paused
      ) {
        scheduleNextFrame();
        return;
      }

      if (!beginPlaybackGpuBurstCoalesce(metadata)) return;

      m.lastRenderWasManualCache = metadata == null && pulledFromCache;

      const inputBinding: GPUBindingResource = viewToUse;

      deps.writeParamsBuffer(); // mutates persistent paramsData in-place, no allocation

      const computeBindGroup = gpu.device.createBindGroup({
        layout: activeLayout,
        entries: [
          { binding: 0, resource: inputBinding },
          { binding: 1, resource: gpu.storageTextureView! },
          { binding: 2, resource: { buffer: gpu.paramsBuffer } },
          { binding: 3, resource: gpu.prevStorageTextureView! },
          // Fall back to neutral 1×1 texture when no previous input exists (first frame).
          { binding: 4, resource: prevInputView ?? gpu.neutralTextureView },
        ],
      });

      const commandEncoder = gpu.device.createCommandEncoder();

      // 1. Compute pass
      const computePass = commandEncoder.beginComputePass();
      computePass.setPipeline(activePipeline);
      computePass.setBindGroup(0, computeBindGroup);
      computePass.dispatchWorkgroups(
        Math.ceil(deps.outputCanvas.width / 16),
        Math.ceil(deps.outputCanvas.height / 16),
      );
      computePass.end();

      // 2. Render pass
      const renderPass = commandEncoder.beginRenderPass({
        colorAttachments: [
          {
            view: gpu.context.getCurrentTexture().createView(),
            clearValue: { r: 0, g: 0, b: 0, a: 1 },
            loadOp: "clear",
            storeOp: "store",
          },
        ],
      });
      renderPass.setPipeline(gpu.renderPipeline);
      renderPass.setBindGroup(0, gpu.renderBindGroup);
      renderPass.draw(4);
      renderPass.end();

      // 3. Copy result → processed cache (in the same command buffer, zero extra GPU round-trips)
      // OPTIMIZATION: Skip caching during offline rendering to save memory and CPU
      if (deps.shouldUseProcessedFrameCache() && frameIdx !== null) {
        const newBytes =
          gpu.storageTexture.width * gpu.storageTexture.height * 4;
        frameCache.evictProcessedLRUForInsert(newBytes);
        if (frameCache.processedBytes + newBytes <= PROCESSED_LIMIT_BYTES) {
          const cacheTex = gpu.device.createTexture({
            size: [gpu.storageTexture.width, gpu.storageTexture.height, 1],
            format: gpu.storageTexture.format,
            usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
          });
          commandEncoder.copyTextureToTexture(
            { texture: gpu.storageTexture },
            { texture: cacheTex },
            [gpu.storageTexture.width, gpu.storageTexture.height, 1],
          );

          const cachedBindGroup = gpu.device.createBindGroup({
            layout: gpu.renderLayout,
            entries: [
              { binding: 0, resource: gpu.sampler },
              { binding: 1, resource: cacheTex.createView() },
            ],
          });

          frameCache.insertProcessedFrame({
            index: frameIdx,
            time: timeForCache,
            texture: cacheTex,
            view: cacheTex.createView(),
            bindGroup: cachedBindGroup,
            bytes: newBytes,
          });
        }
      }

      // Ping-pong temporal feedback for optical flow moshing.
      commandEncoder.copyTextureToTexture(
        { texture: gpu.storageTexture },
        { texture: gpu.prevStorageTexture! },
        [gpu.storageTexture.width, gpu.storageTexture.height, 1],
      );

      gpu.device.queue.submit([commandEncoder.finish()]);
      if (metadata != null && metadata.presentedFrames !== undefined) {
        m.lastGpuSubmittedPresentedFrames = metadata.presentedFrames;
      }
      deps.bumpDownSuppressTemporalHistoryIfPositive();

      // Swap input textures + their cached views so current becomes previous for next frame.
      if (!pulledFromCache && gpu.currInputTexture && gpu.prevInputTexture) {
        const tmpTex = gpu.prevInputTexture;
        gpu.prevInputTexture = gpu.currInputTexture;
        gpu.currInputTexture = tmpTex;
        const tmpView = gpu.prevInputTextureView;
        gpu.prevInputTextureView = gpu.currInputTextureView;
        gpu.currInputTextureView = tmpView;
      }

      scheduleNextFrame();
    } finally {
      m.lastRenderTimeMs = performance.now() - startTime;
    }
  }

  return { render, scheduleNextFrame, primePlaybackFrameLoop };
}
