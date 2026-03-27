import { registerSW } from "virtual:pwa-register";
import "./style.css";
import "@fontsource/archivo-black/400.css";
import "@fontsource/oswald/700.css";
import "@fontsource/space-mono/400.css";
import "@fontsource/space-mono/700.css";
import { installGlobalErrorOverlay } from "./ui/globalErrorOverlay";

import { isWebGPUAvailable } from "./gpu/gpu_utils";
import { initFlowCanvas } from "./flow/flowCanvas";
import { queryAppDom, renderAppShell } from "./appShell";
import { initWidescreenSidebarLayout } from "./appShell/widescreenSidebarLayout";
import { shouldWarmVideoTranscoder } from "./video/transcoderFlags";
import { installPwaPrompt } from "./ui/pwaPrompt";
import { showWebGPUUnsupportedBanner } from "./ui/webgpuBanner";

import {
  closePresetManager,
  loadSavedSidebarPresets,
  markPresetSelectionCurrent,
  setupPresetManagerListeners,
  tryConsumePresetFromUrlHash,
  type PresetManagerDeps,
} from "./presets/presetManager";
import { DEFAULT_CACHE_TEXT, sampleVideoUrl } from "./runtime/constants";

import { clearTranscodedVideoDiskCache } from "./video/clearTranscodeDiskCache";
import { FrameCache } from "./video/frameCache";
import { stopGhostCache, type GhostCacheDeps } from "./video/ghostCache";

import { type LiveExportDeps } from "./video/liveExport";
import { type StillFrameExportDeps } from "./video/stillFrameExport";
import {
  drawTimeline as drawTimelineImpl,
  startUILoop as startUILoopImpl,
  updateCacheCanvas as updateCacheCanvasImpl,
  updateTimeDisplayText as updateTimeDisplayTextImpl,
  type TimelineDeps,
} from "./timeline/timeline";
import {
  attachSeekScrubHandlers,
  bumpDownSuppressTemporalHistoryIfPositive,
  seekScrubState,
} from "./timeline/seekScrub";
import { createRenderLoop, renderLoopMutable } from "./renderer/renderLoop";
import { paramsFingerprint } from "./renderer/paramUniforms";
import { playbackTiming } from "./renderer/playbackTiming";
import { applyDefaultSampleVideo } from "./source";
import { engineState } from "./state/engineState";
import { setupParameterController } from "./controllers/parameterController";

renderAppShell();
initWidescreenSidebarLayout();

const pwaPrompt = installPwaPrompt({
  onApplyUpdate: () => updateSW(true),
});
const updateSW = registerSW({
  onNeedRefresh() {
    pwaPrompt.showUpdateReady();
  },
  onOfflineReady() {
    pwaPrompt.showOfflineReady();
  },
});

const useCanvasVideoSource = shouldWarmVideoTranscoder();

const appDom = queryAppDom();
const {
  sourceVideo,
  outputCanvas,
  resetParamsBtn,
  presetChooser,
  presetManageBtn,
  clearTranscodeCacheBtn,
  exportBtn,
  renderBtn,
  refreshMoshBtn,
  copyFrameBtn,
  downloadFrameBtn,
  liveExportPicker,
  liveExportPickerSize,
  liveExportWebmBtn,
  liveExportMp4Btn,
  liveExportCancelBtn,
  playPauseBtn,
  seekSlider,
  timeDisplay,
  cachingText,
  timelineCanvas,
  timelineCtx,
  presetModal,
  changelogModal,
  changelogCloseBtn,
  changelogHeaderBtn,
  presetCloseBtn,
  presetStatus,
  presetNameInput,
  presetSaveBtn,
  presetUpdateBtn,
  presetDeleteBtn,
  presetExportText,
  presetDownloadJsonBtn,
  presetCopyBase64Btn,
  presetQrImage,
  presetCopyQrBtn,
  presetSaveQrBtn,
  presetImportText,
  presetImportBtn,
  presetImportFileBtn,
  presetImportFileInput,
  presetCopyLinkBtn,
  presetShareLinkBtn,
  presetImportPasteBtn,
  presetImportQrBtn,
  presetImportQrInput,
  fpsDisplay,
  welcomeSampleOverlay,
  controlsPanelInertScope,
  flowPanelAside,
  viewerTransport,
  tryExampleVideoBtn,
  flowCanvas,
  flowToggleBtn,
  flowClearBtn,
  flowLabel,
} = appDom;

installGlobalErrorOverlay();
const videoUploadCanvas = document.createElement("canvas");
const videoUploadCanvasCtx = videoUploadCanvas.getContext("2d", {
  alpha: false,
});

import { mediaState } from "./state/mediaState";
import { setupMediaController } from "./controllers/mediaController";

import { offlineRenderState } from "./state/offlineRenderState";
import { liveExportState } from "./state/liveExportState";
import { presetState } from "./state/presetState";
import { flowState } from "./state/flowState";
import { videoMetadataState } from "./state/videoMetadataState";
import { setupCanvasController } from "./controllers/canvasController";
import { setupComparisonController } from "./controllers/comparisonController";
import { setupPlaybackController } from "./controllers/playbackController";
import { setupGpuController } from "./controllers/gpuController";

function hasTemporalFeedbackEffects(): boolean {
  return (
    engineState.mosh > 0 ||
    engineState.datamosh > 0 ||
    engineState.blockEcho > 0
  );
}

const { getGpuContext, ensureGpuReady, writeParamsBuffer } = setupGpuController(
  {
    outputCanvas,
    updateCacheCanvas: () => updateCacheCanvas(),
    activeSourceTimeSec: () => activeSourceTime(),
    activeSourceWidth: () => activeSourceWidth(),
    activeSourceHeight: () => activeSourceHeight(),
  },
);

const { updateCanvasSize, resizeCanvasToVideo } = setupCanvasController({
  outputCanvas,
  activeSourceWidth: () => activeSourceWidth(),
  activeSourceHeight: () => activeSourceHeight(),
  getGpuContext,
  clearProcessedCache: () => frameCache.clearProcessedCache(),
});

const comparisonApiRef: {
  current: ReturnType<typeof setupComparisonController> | undefined;
} = { current: undefined };

function shouldUseProcessedFrameCache(): boolean {
  return (
    !offlineRenderState.isOfflineRendering &&
    !hasTemporalFeedbackEffects() &&
    (sourceVideo.paused ||
      seekScrubState.isSeeking ||
      sourceVideo.seeking ||
      sourceVideo.readyState < 2)
  );
}

const ghostCacheDeps: GhostCacheDeps = {
  ensureGpuReady,
  get device() {
    return getGpuContext()!.device;
  },
  get useCanvasVideoSource() {
    return useCanvasVideoSource;
  },
  get isOfflineRendering() {
    return offlineRenderState.isOfflineRendering;
  },
  get isSeeking() {
    return seekScrubState.isSeeking;
  },
  get sourceVideoPaused() {
    return sourceVideo.paused;
  },
  get currentCacheBytes() {
    return frameCache.currentCacheBytes;
  },
  setVideoAllPresentationTimesSorted(v) {
    frameCache.setPresentationTimesSorted(v);
  },
  clearPresentationTimes() {
    frameCache.setPresentationTimesSorted(null);
  },
  syncRawFrameSlotBasis: () => frameCache.syncRawFrameSlotBasis(),
  queueMicrotaskPtsAndTimeline() {
    queueMicrotask(() => {
      updateTimeDisplayText();
      drawTimeline();
    });
  },
  queueMicrotaskMetadataUi() {
    queueMicrotask(() => {
      updateTimeDisplayText();
      drawTimeline();
      updateCacheStatusText();
    });
  },
  queueMicrotaskDecoderFailUi() {
    queueMicrotask(() => {
      updateTimeDisplayText();
      drawTimeline();
      updateCacheStatusText();
    });
  },
  queueMicrotaskAfterFlush() {
    queueMicrotask(() => {
      updateCacheCanvas();
      updateCacheStatusText();
      drawTimeline();
    });
  },
  insertRawFrame: (f) => frameCache.insertRawFrame(f),
  updateCacheCanvas,
  updateCacheStatusText,
  updateTimeDisplayText,
  drawTimeline,
  getDetectedVideoFPS() {
    return videoMetadataState.detectedVideoFPS;
  },
  setDetectedVideoFPS(v) {
    videoMetadataState.detectedVideoFPS = v;
  },
  setOfflineFps(v) {
    videoMetadataState.OFFLINE_FPS = v;
  },
  onFpsEstimateChangedWhileHavePts() {
    if (!frameCache.presentationTimesSorted) return;
    frameCache.syncRawFrameSlotBasis();
    updateTimeDisplayText();
  },
};

const {
  isImageSource,
  activeSourceWidth,
  activeSourceHeight,
  activeSourceTime,
  activeCopySource,
  setSourceVideoUrl,
  updateSourceModeUI,
  resetSelectedMediaState,
} = setupMediaController({
  dom: appDom,
  useCanvasVideoSource,
  videoUploadCanvas,
  videoUploadCanvasCtx,
  onClearOfflineRenderingIfNeeded: () => {
    if (offlineRenderState.isOfflineRendering)
      offlineRenderState.isOfflineRendering = false;
  },
  onResetRenderButtonState: resetRenderButtonState,
  onSetCacheStatusText: setCacheStatusText,
  onDrawTimeline: drawTimeline,
  onResetRenderLoopState: () => {
    playbackTiming.lastMediaTime = 0;
    playbackTiming.lastMediaTimestamp = performance.now();
    renderLoopMutable.isRenderScheduled = false;
    renderLoopMutable.lastGpuSubmittedPresentedFrames = null;
    renderLoopMutable.lastNonRvfcPlaybackGpuWallMs = 0;
  },
  onResetFrameCacheAndGhost: () => {
    stopGhostCache();
    frameCache.resetForNewSource();
  },
  getGhostCacheDeps: () => ghostCacheDeps,
  setWelcomeSampleOverlayVisible,
  onRender: () => renderLiveExportPreview(), // Use the mutable reference!
  onResizeCanvasToVideo: resizeCanvasToVideo,
  defaultCacheText: DEFAULT_CACHE_TEXT,
  cancelImageFrameRequest: () => {
    if (renderLoopMutable.imageFrameRequestHandle != null) {
      cancelAnimationFrame(renderLoopMutable.imageFrameRequestHandle);
      renderLoopMutable.imageFrameRequestHandle = undefined;
    }
  },
  isImageFrameRequestPending: () =>
    renderLoopMutable.imageFrameRequestHandle != null,
  onComparisonSourceImage: (src) =>
    comparisonApiRef.current?.syncComparisonSourceImage(src),
  onClearComparisonSourceImage: () =>
    comparisonApiRef.current?.clearComparisonSourceImage(),
  onComparisonAfterMediaChange: () =>
    comparisonApiRef.current?.refreshComparisonVisibility(),
});

comparisonApiRef.current = setupComparisonController({
  dom: appDom,
  isImageSource,
  onResizeCanvasToVideo: resizeCanvasToVideo,
});

function resetSelectedMediaStateHook(): void {
  resetSelectedMediaState();
}

function setCacheStatusText(text: string): void {
  if (cachingText) cachingText.textContent = text;
}

function updateCacheStatusText(): void {
  const total = frameCache.knownTotalFrameCount();
  if (total && total > 0) {
    const covered = Math.min(frameCache.cachedPresentationSampleCount(), total);
    setCacheStatusText(`CACHED: ${covered} / ${total} FRAMES`);
    return;
  }
  setCacheStatusText(`CACHED: ${frameCache.rawFramesList.length} FRAMES`);
}

function tryCacheVisibleFrameAtTime(
  source: HTMLVideoElement | HTMLCanvasElement | HTMLImageElement | null,
  width: number,
  height: number,
  time: number,
): void {
  if (!source || width <= 0 || height <= 0 || !getGpuContext()) return;
  const slot = frameCache.uniformFrameSlotAtTime(time);
  if (slot !== null && frameCache.hasRawSlotCached(slot)) return;
  try {
    const gpu = getGpuContext()!;
    const tex = gpu.device.createTexture({
      size: [width, height, 1],
      format: "rgba8unorm",
      usage:
        GPUTextureUsage.TEXTURE_BINDING |
        GPUTextureUsage.COPY_DST |
        GPUTextureUsage.RENDER_ATTACHMENT,
    });
    gpu.device.queue.copyExternalImageToTexture({ source }, { texture: tex }, [
      width,
      height,
    ]);
    if (
      frameCache.insertRawFrame({
        time,
        texture: tex,
        view: tex.createView(),
        slot: null,
      })
    ) {
      updateCacheCanvas();
      updateCacheStatusText();
      updateTimeDisplayText();
    }
  } catch {
    // Best-effort cache fill for sparse scrubbing.
  }
}

function livePlaybackCacheTime(): number {
  const dur = sourceVideo.duration;
  if (dur > 0 && isFinite(dur)) {
    return Math.max(0, Math.min(sourceVideo.currentTime, dur));
  }
  return Math.max(0, sourceVideo.currentTime);
}

// Removed updateSourceModeUI

function resetRenderButtonState(): void {
  renderBtn.textContent = "RENDER";
  renderBtn.style.backgroundColor = "#00e5ff";
  renderBtn.style.color = "black";
}

const timelineDeps: TimelineDeps = {
  timeDisplay,
  timelineCanvas,
  timelineCtx,
  get sourceVideo() {
    return sourceVideo;
  },
  isImageSource,
  get uploadTranscodeTimelineProgress() {
    return mediaState.uploadTranscodeTimelineProgress;
  },
  get isOfflineRendering() {
    return offlineRenderState.isOfflineRendering;
  },
  get offlineRenderHeadTimeForUi() {
    return offlineRenderState.offlineRenderHeadTimeForUi;
  },
  get isSeeking() {
    return seekScrubState.isSeeking;
  },
  get scrubTime() {
    return seekScrubState.scrubTime;
  },
  get lastMediaTime() {
    return playbackTiming.lastMediaTime;
  },
  get lastMediaTimestamp() {
    return playbackTiming.lastMediaTimestamp;
  },
  get rawFrames() {
    return frameCache.rawFramesList;
  },
  get processedFrameMap() {
    return frameCache.processedFrames;
  },
  uniformFrameSlotAtTime: (t) => frameCache.uniformFrameSlotAtTime(t),
  uniformTimelineTimeForSlot: (slot) =>
    frameCache.uniformTimelineTimeForSlot(slot),
  rawFrameTimeEpsilon: () => frameCache.rawFrameTimeEpsilon(),
  get detectedVideoFPS() {
    return videoMetadataState.detectedVideoFPS;
  },
  get OFFLINE_FPS() {
    return videoMetadataState.OFFLINE_FPS;
  },
  get videoAllPresentationTimesSorted() {
    return frameCache.presentationTimesSorted;
  },
  hasExactCachedFrameAtTime: (t) => frameCache.hasExactCachedFrameAtTime(t),
};

const frameCache = new FrameCache({
  getVideoDuration() {
    return sourceVideo.duration;
  },
  getOfflineFpsFallback() {
    return videoMetadataState.OFFLINE_FPS;
  },
  getDetectedVideoFps() {
    return videoMetadataState.detectedVideoFPS;
  },
  onSlotBasisInvalidated() {
    updateCacheCanvas();
    updateCacheStatusText();
  },
  shouldDeferProcessedCacheClear() {
    return shouldUseProcessedFrameCache() && !hasTemporalFeedbackEffects();
  },
  getEstimatedTimelineFps() {
    return Math.max(
      1,
      videoMetadataState.detectedVideoFPS ?? videoMetadataState.OFFLINE_FPS,
    );
  },
  getVideoCurrentTime() {
    return sourceVideo.currentTime;
  },
  getTimelineDisplayFps() {
    return Math.max(
      1,
      videoMetadataState.detectedVideoFPS ?? videoMetadataState.OFFLINE_FPS,
    );
  },
});

function drawTimeline() {
  drawTimelineImpl(timelineDeps);
}
function updateTimeDisplayText() {
  updateTimeDisplayTextImpl(timelineDeps);
}
function updateCacheCanvas() {
  updateCacheCanvasImpl(timelineDeps);
}
function startUILoop() {
  startUILoopImpl(timelineDeps);
}

// --- Sidebar preset values (chooser / modal / import-export in presetManager) ---
const { getCurrentSidebarPresetValues, applySidebarPresetValues } =
  setupParameterController({
    dom: appDom,
    onParamsChanged: (clearCache = false) => {
      markPresetSelectionCurrent(presetManagerDeps);
      if (clearCache) frameCache.clearProcessedCache();
    },
    clearProcessedCache: () => frameCache.clearProcessedCache(),
  });

function activeLiveExportFPS(): number {
  return Math.max(
    1,
    Math.min(
      60,
      Math.round(
        videoMetadataState.detectedVideoFPS ??
          videoMetadataState.OFFLINE_FPS ??
          30,
      ),
    ),
  );
}

function getCurrentExportSize(): { width: number; height: number } | null {
  let width = outputCanvas.width;
  let height = outputCanvas.height;

  if (width > 0 && height > 0) {
    return { width, height };
  }

  const sourceWidth = activeSourceWidth();
  const sourceHeight = activeSourceHeight();
  if (sourceWidth <= 0 || sourceHeight <= 0) {
    return null;
  }

  width = Math.ceil(Math.floor(sourceWidth / engineState.scale) / 16) * 16;
  height = Math.ceil(Math.floor(sourceHeight / engineState.scale) / 16) * 16;
  return width > 0 && height > 0 ? { width, height } : null;
}

let renderLiveExportPreview = () => {};

const liveExportDeps: LiveExportDeps = {
  get outputCanvas() {
    return outputCanvas;
  },
  getCurrentExportSize,
  activeLiveExportFPS,
  render: () => renderLiveExportPreview(),
  get liveExportSession() {
    return liveExportState.liveExportSession;
  },
  setLiveExportSession(s) {
    liveExportState.liveExportSession = s;
  },
  get isLiveExportFinalizing() {
    return liveExportState.isLiveExportFinalizing;
  },
  setIsLiveExportFinalizing(v) {
    liveExportState.isLiveExportFinalizing = v;
  },
  get isLiveExportStarting() {
    return liveExportState.isLiveExportStarting;
  },
  setIsLiveExportStarting(v) {
    liveExportState.isLiveExportStarting = v;
  },
  liveExportPicker,
  liveExportPickerSize,
  liveExportWebmBtn,
  liveExportMp4Btn,
  liveExportCancelBtn,
  exportBtn,
};

const presetManagerDeps: PresetManagerDeps = {
  presetChooser,
  presetManageBtn,
  presetModal,
  presetCloseBtn,
  presetStatus,
  presetNameInput,
  presetSaveBtn,
  presetUpdateBtn,
  presetDeleteBtn,
  presetExportText,
  presetDownloadJsonBtn,
  presetCopyBase64Btn,
  presetQrImage,
  presetCopyQrBtn,
  presetSaveQrBtn,
  presetImportText,
  presetImportBtn,
  presetImportFileBtn,
  presetImportFileInput,
  presetCopyLinkBtn,
  presetShareLinkBtn,
  presetImportPasteBtn,
  presetImportQrBtn,
  presetImportQrInput,
  resetParamsBtn,
  getSavedSidebarPresets: () => presetState.savedSidebarPresets,
  setSavedSidebarPresets: (v) => {
    presetState.savedSidebarPresets = v;
  },
  getPresetChooserSelection: () => presetState.presetChooserSelection,
  setPresetChooserSelection: (v) => {
    presetState.presetChooserSelection = v;
  },
  bumpPresetQrSyncToken: () => {
    presetState.presetQrSyncToken += 1;
    return presetState.presetQrSyncToken;
  },
  getPresetQrSyncToken: () => presetState.presetQrSyncToken,
  getCurrentSidebarPresetValues,
  applySidebarPresetValues,
};

function setWelcomeSampleOverlayVisible(visible: boolean): void {
  welcomeSampleOverlay.classList.toggle("hidden", !visible);
  controlsPanelInertScope.toggleAttribute("inert", visible);
  flowPanelAside.toggleAttribute("inert", visible);
  viewerTransport.toggleAttribute("inert", visible);
  if (!visible) {
    updateSourceModeUI();
  }
}

// --- Initialization ---
async function startApp() {
  if (!isWebGPUAvailable()) {
    showWebGPUUnsupportedBanner(
      "This browser does not expose WebGPU. Try Chrome, Edge, or another WebGPU-capable browser.",
    );
    return;
  }

  setupEventListeners();
  setupVideoTranscoderWarmupOnIntent();
  loadSavedSidebarPresets(presetManagerDeps);
  tryConsumePresetFromUrlHash(presetManagerDeps);
  updateSourceModeUI();
  initFlowCanvas(
    flowCanvas,
    flowToggleBtn,
    flowClearBtn,
    flowLabel,
    (state) => {
      flowState.customFlowX = state.flowX;
      flowState.customFlowY = state.flowY;
      flowState.useCustomFlow = state.useCustomFlow;
      frameCache.clearProcessedCache();
    },
  );

  resetSelectedMediaState();
  updateSourceModeUI();
  setWelcomeSampleOverlayVisible(true);

  tryExampleVideoBtn.addEventListener("click", () => {
    mediaState.userMediaChoiceEpoch += 1;
    const baselineEpoch = mediaState.userMediaChoiceEpoch;
    resetSelectedMediaStateHook();
    updateSourceModeUI();
    setWelcomeSampleOverlayVisible(false);
    tryExampleVideoBtn.disabled = true;
    void applyDefaultSampleVideo(baselineEpoch, {
      useCanvasVideoSource,
      sampleVideoUrl,
      defaultCacheText: DEFAULT_CACHE_TEXT,
      getUserMediaEpoch: () => mediaState.userMediaChoiceEpoch,
      setSourceKindVideoClearImage: () => {
        mediaState.currentSourceKind = "video";
        mediaState.sourceImage = null;
      },
      setCacheStatusText,
      setTranscodeProgress: (p: number | null) => {
        mediaState.uploadTranscodeTimelineProgress = p;
      },
      drawTimeline,
      assignVideoUrl: setSourceVideoUrl,
      updateSourceModeUI,
      sourceVideo,
      ghostCacheDeps,
    }).then((ok: boolean) => {
      tryExampleVideoBtn.disabled = false;
      if (!ok && mediaState.userMediaChoiceEpoch === baselineEpoch) {
        setWelcomeSampleOverlayVisible(true);
      }
    });
  });

  sourceVideo.addEventListener("loadeddata", () => {
    sourceVideo.play().catch(() => {});
  });
}

function setupEventListeners() {
  setupPresetManagerListeners(presetManagerDeps);

  clearTranscodeCacheBtn.addEventListener("click", () => {
    void clearTranscodedVideoDiskCache().then((hadEntries) => {
      setCacheStatusText(
        hadEntries
          ? "Cleared saved transcoded videos from this browser."
          : "No saved transcode cache found (or storage unavailable).",
      );
      window.setTimeout(() => {
        updateCacheStatusText();
      }, 2800);
    });
  });

  function closeChangelogModal(): void {
    changelogModal.classList.add("hidden");
    changelogModal.classList.remove("flex");
  }

  function openChangelogModal(): void {
    changelogModal.classList.remove("hidden");
    changelogModal.classList.add("flex");
  }

  changelogHeaderBtn.addEventListener("click", () => openChangelogModal());
  changelogCloseBtn.addEventListener("click", () => closeChangelogModal());
  changelogModal.addEventListener("click", (event) => {
    if (event.target === changelogModal) closeChangelogModal();
  });

  window.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    if (!changelogModal.classList.contains("hidden")) {
      closeChangelogModal();
      return;
    }
    if (!presetModal.classList.contains("hidden")) {
      closePresetManager(presetManagerDeps);
    }
  });
}

let videoTranscoderWarmupPromise: Promise<void> | null = null;

function queueVideoTranscoderWarmup(): void {
  if (!useCanvasVideoSource || videoTranscoderWarmupPromise) return;
  videoTranscoderWarmupPromise = import("./video/videoTranscoder")
    .then((module) => module.warmVideoTranscoder())
    .catch((error) => {
      videoTranscoderWarmupPromise = null;
      console.warn("FFmpeg warmup failed:", error);
    });
}

function setupVideoTranscoderWarmupOnIntent(): void {
  if (!useCanvasVideoSource) return;
  const warm = () => {
    void queueVideoTranscoderWarmup();
  };
  const warmTargets: EventTarget[] = [
    tryExampleVideoBtn,
    appDom.headerVideoUploadDropzone,
    appDom.welcomeUploadDropzone,
  ];
  for (const target of warmTargets) {
    target.addEventListener("pointerenter", warm, {
      once: true,
      passive: true,
    });
    target.addEventListener("focusin", warm, { once: true });
    target.addEventListener("dragenter", warm, { once: true });
  }
}

// --- Params uniform write helper (reuses persistent buffer) ---
const { render, scheduleNextFrame, primePlaybackFrameLoop } = createRenderLoop({
  fpsDisplay,
  getGpu: getGpuContext,
  ensureGpuReady,
  getFrameCache: () => frameCache,
  sourceVideo,
  outputCanvas,
  useCanvasVideoSource,
  isImageSource,
  isOfflineRendering: () => offlineRenderState.isOfflineRendering,
  getIsSeeking: () => seekScrubState.isSeeking,
  getScrubTime: () => seekScrubState.scrubTime,
  livePlaybackCacheTime,
  writeParamsBuffer,
  getParamsFingerprint: () =>
    paramsFingerprint({
      quality: engineState.quality,
      scale: engineState.scale,
      chromaMode: engineState.chromaMode,
      glitch: engineState.glitch,
      mosh: engineState.mosh,
      corrupt: engineState.corrupt,
      datamosh: engineState.datamosh,
      ringing: engineState.ringing,
      colorDrift: engineState.colorDrift,
      chromaBleed: engineState.chromaBleed,
      bitCrush: engineState.bitCrush,
      blockEcho: engineState.blockEcho,
      echoBeforeJpeg: engineState.echoBeforeJpeg,
      dcStep: engineState.dcStep,
      phaseShift: engineState.phaseShift,
    }),
  shouldUseProcessedFrameCache,
  hasTemporalFeedbackEffects,
  updateCanvasSize,
  tryCacheVisibleFrameAtTime,
  activeSourceWidth,
  activeSourceHeight,
  activeCopySource,
  getCurrentScale: () => engineState.scale,
  bumpDownSuppressTemporalHistoryIfPositive,
  updateCacheCanvas,
  updateCacheStatusText,
});
renderLiveExportPreview = render;

const stillFrameDeps: StillFrameExportDeps = {
  get outputCanvas() {
    return outputCanvas;
  },
  copyFrameBtn,
  downloadFrameBtn,
  render,
};

const exportControllerDeps = {
  dom: appDom,
  liveExportDeps,
  isOfflineRendering: () => offlineRenderState.isOfflineRendering,
};

const offlineRenderControllerDeps = {
  dom: appDom,
  liveExportDeps,
  stillFrameDeps,
  offlineRenderDeps: {
    get isOfflineRendering() {
      return offlineRenderState.isOfflineRendering;
    },
    setIsOfflineRendering(v: boolean) {
      offlineRenderState.isOfflineRendering = v;
    },
    get offlineFrameCount() {
      return offlineRenderState.offlineFrameCount;
    },
    setOfflineFrameCount(n: number) {
      offlineRenderState.offlineFrameCount = n;
    },
    get offlineRenderHeadTimeForUi() {
      return offlineRenderState.offlineRenderHeadTimeForUi;
    },
    setOfflineRenderHeadTimeForUi(t: number) {
      offlineRenderState.offlineRenderHeadTimeForUi = t;
    },
    get offlineEncoder() {
      return offlineRenderState.offlineEncoder;
    },
    get offlineMuxer() {
      return offlineRenderState.offlineMuxer;
    },
    get sourceVideo() {
      return sourceVideo;
    },
    get outputCanvas() {
      return outputCanvas;
    },
    get renderBtn() {
      return renderBtn;
    },
    get OFFLINE_FPS() {
      return videoMetadataState.OFFLINE_FPS;
    },
    offlineRenderFrameTotal: () => frameCache.offlineRenderFrameTotal(),
    offlineRenderFrameTimeAt: (index: number) =>
      frameCache.offlineRenderFrameTimeAt(index),
    offlineRenderFrameDurationUs: (index: number) =>
      frameCache.offlineRenderFrameDurationUs(index),
    uniformFrameSlotAtTime: (t: number) => frameCache.uniformFrameSlotAtTime(t),
    rawFrameAtSlot: (slot: number) => frameCache.rawFrameAtSlot(slot),
    render,
    drawTimeline,
    get isSeeking() {
      return seekScrubState.isSeeking;
    },
    setIsSeeking(v: boolean) {
      seekScrubState.isSeeking = v;
    },
    get scrubTime() {
      return seekScrubState.scrubTime;
    },
    setScrubTime(v: number | null) {
      seekScrubState.scrubTime = v;
    },
    isImageSource,
    activeSourceWidth,
    activeSourceHeight,
    activeCopySource,
  },
  isImageSource,
  clearProcessedCache: () => frameCache.clearProcessedCache(),
  updateSourceModeUI,
  getOfflineFps: () => videoMetadataState.OFFLINE_FPS,
};

let exportControllerLoadPromise: Promise<void> | null = null;
let offlineRenderControllerLoadPromise: Promise<void> | null = null;

function ensureExportControllerLoaded(): Promise<void> {
  if (!exportControllerLoadPromise) {
    exportControllerLoadPromise = import("./controllers/exportController").then(
      ({ initializeExportController }) => {
        initializeExportController(exportControllerDeps);
      },
    );
  }
  return exportControllerLoadPromise;
}

function ensureOfflineRenderControllerLoaded(): Promise<void> {
  if (!offlineRenderControllerLoadPromise) {
    offlineRenderControllerLoadPromise =
      import("./controllers/offlineRenderController").then(
        ({ setupOfflineRenderController }) => {
          setupOfflineRenderController(offlineRenderControllerDeps);
        },
      );
  }
  return offlineRenderControllerLoadPromise;
}

function bootstrapAsyncController(
  button: HTMLButtonElement,
  ensureLoaded: () => Promise<void>,
): void {
  const prefetch = () => {
    void ensureLoaded();
  };
  const onClick = (event: Event) => {
    event.preventDefault();
    event.stopImmediatePropagation();
    void ensureLoaded()
      .then(() => {
        button.removeEventListener("click", onClick, true);
        button.click();
      })
      .catch((error) => {
        console.error("Failed to load controller", error);
      });
  };
  button.addEventListener("click", onClick, { capture: true });
  button.addEventListener("pointerenter", prefetch, {
    once: true,
    passive: true,
  });
  button.addEventListener("focusin", prefetch, { once: true });
}

bootstrapAsyncController(exportBtn, ensureExportControllerLoaded);
bootstrapAsyncController(renderBtn, ensureOfflineRenderControllerLoaded);
bootstrapAsyncController(copyFrameBtn, ensureOfflineRenderControllerLoaded);
bootstrapAsyncController(downloadFrameBtn, ensureOfflineRenderControllerLoaded);

// Kick off loop if video is already playing at module load time
if (sourceVideo.readyState >= 2 && !sourceVideo.paused) {
  requestAnimationFrame(() => render());
}

setupPlaybackController({
  sourceVideo,
  playPauseBtn,
  refreshMoshBtn,
  isImageSource,
  clearProcessedCache: () => frameCache.clearProcessedCache(),
  render,
  drawTimeline,
  updateTimeDisplayText,
  startUILoop,
  hasProcessedBytes: () => frameCache.processedBytes > 0,
});

attachSeekScrubHandlers({
  sourceVideo,
  timelineCanvas,
  seekSlider,
  getFrameCache: () => frameCache,
  isImageSource,
  isOfflineRendering: () => offlineRenderState.isOfflineRendering,
  render,
  scheduleNextFrame,
  primePlaybackFrameLoop,
  drawTimeline,
  startUILoop,
  updateTimeDisplayText,
});

requestAnimationFrame(() => {
  void import("./ui/paramHelpTooltips").then(
    ({ initParamHelpFloatingTips }) => {
      initParamHelpFloatingTips();
    },
  );
});
startApp();
