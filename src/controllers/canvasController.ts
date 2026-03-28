import type { GpuContext } from "../gpu/gpuContext";

export interface CanvasControllerDeps {
  outputCanvas: HTMLCanvasElement;
  /** Kept in sync with canvas display size so compare modes (especially slide) align source and processed. */
  comparisonSourceVideo: HTMLVideoElement;
  comparisonSourceImg: HTMLImageElement;
  activeSourceWidth: () => number;
  activeSourceHeight: () => number;
  getGpuContext: () => GpuContext | null;
  clearProcessedCache: () => void;
}

export function setupCanvasController(deps: CanvasControllerDeps) {
  const {
    outputCanvas,
    comparisonSourceVideo,
    comparisonSourceImg,
    activeSourceWidth,
    activeSourceHeight,
    getGpuContext,
    clearProcessedCache,
  } = deps;

  function resizeCanvasToVideo() {
    const parent = outputCanvas.parentElement;
    if (!parent) return;
    const pw = parent.clientWidth;
    const ph = parent.clientHeight;
    if (pw < 2) return;

    const width = activeSourceWidth();
    const height = activeSourceHeight();
    if (width <= 0 || height <= 0) return;

    const sourceAspect = width / height;
    const isNarrowLayout = window.innerWidth < 1024;
    const narrowHeightCap =
      window.innerWidth < 500
        ? Math.min(window.innerHeight * 0.22, 8.5 * 16)
        : Math.min(window.innerHeight * 0.38, 16 * 16);
    const maxDisplayHeight =
      isNarrowLayout || ph < 2
        ? narrowHeightCap
        : Math.min(ph, window.innerHeight);
    let displayWidth = pw;
    let displayHeight = Math.round(displayWidth / sourceAspect);
    if (displayHeight > maxDisplayHeight) {
      displayHeight = Math.max(1, Math.round(maxDisplayHeight));
      displayWidth = Math.round(displayHeight * sourceAspect);
    }

    outputCanvas.style.width = `${displayWidth}px`;
    outputCanvas.style.height = `${displayHeight}px`;
    outputCanvas.style.maxWidth = "100%";
    outputCanvas.style.maxHeight = `${Math.max(1, Math.round(maxDisplayHeight))}px`;
    outputCanvas.style.objectFit = "fill";
    outputCanvas.style.aspectRatio = `${width} / ${height}`;
    outputCanvas.style.flex = "0 0 auto";
    outputCanvas.style.margin = "auto";
    outputCanvas.style.alignSelf = "center";

    const syncCompareSource = (el: HTMLElement) => {
      el.style.width = `${displayWidth}px`;
      el.style.height = `${displayHeight}px`;
      el.style.maxWidth = "100%";
      el.style.maxHeight = `${Math.max(1, Math.round(maxDisplayHeight))}px`;
      el.style.objectFit = "contain";
      el.style.aspectRatio = `${width} / ${height}`;
      el.style.flex = "0 0 auto";
      el.style.margin = "auto";
      el.style.alignSelf = "center";
    };
    syncCompareSource(comparisonSourceVideo);
    syncCompareSource(comparisonSourceImg);
  }

  function updateCanvasSize(targetWidth: number, targetHeight: number) {
    if (
      outputCanvas.width !== targetWidth ||
      outputCanvas.height !== targetHeight
    ) {
      outputCanvas.width = targetWidth;
      outputCanvas.height = targetHeight;
      resizeCanvasToVideo();

      const gpu = getGpuContext();
      if (!gpu) return;
      gpu.recreateStorageTextures(outputCanvas.width, outputCanvas.height);

      // Changing resolution invalidates all cached processed frames
      clearProcessedCache();
    }
  }

  let resizeCanvasRaf = 0;
  const schedulePreviewLayout = () => {
    if (resizeCanvasRaf) return;
    resizeCanvasRaf = requestAnimationFrame(() => {
      resizeCanvasRaf = requestAnimationFrame(() => {
        resizeCanvasRaf = 0;
        if (activeSourceWidth() > 0 && activeSourceHeight() > 0)
          resizeCanvasToVideo();
      });
    });
  };

  window.addEventListener("resize", schedulePreviewLayout);

  const previewHost = outputCanvas.parentElement;
  if (previewHost && typeof ResizeObserver !== "undefined") {
    const ro = new ResizeObserver(() => schedulePreviewLayout());
    ro.observe(previewHost);
  }

  return { resizeCanvasToVideo, updateCanvasSize };
}
