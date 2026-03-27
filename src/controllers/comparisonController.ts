import type { AppDom } from "../appShell";
import { comparisonState, type ComparisonMode } from "../state/comparisonState";

/** Must match `.comparison-slider` thumb width in `style.css`. */
const COMPARISON_SLIDER_THUMB_PX = 16;

export interface ComparisonControllerDeps {
  dom: AppDom;
  isImageSource: () => boolean;
  onResizeCanvasToVideo: () => void;
}

export function setupComparisonController(deps: ComparisonControllerDeps) {
  const {
    viewerComparisonRoot,
    comparisonOutputWrap,
    comparisonSlideDivider,
    comparisonSlideUi,
    comparisonSlider,
    comparisonOffBtn,
    comparisonSideBtn,
    comparisonSlideBtn,
    sourceVideo,
    comparisonSourceImg,
  } = deps.dom;

  function setMode(mode: ComparisonMode) {
    comparisonState.mode = mode;
    viewerComparisonRoot.dataset.comparison =
      mode === "off" ? "off" : mode === "sideBySide" ? "sideBySide" : "sliding";

    comparisonOffBtn.setAttribute("aria-pressed", String(mode === "off"));
    comparisonSideBtn.setAttribute(
      "aria-pressed",
      String(mode === "sideBySide"),
    );
    comparisonSlideBtn.setAttribute("aria-pressed", String(mode === "sliding"));

    const showCompare = mode !== "off";
    const imageMode = deps.isImageSource();

    sourceVideo.classList.toggle("hidden", !showCompare || imageMode);
    comparisonSourceImg.classList.toggle("hidden", !showCompare || !imageMode);

    comparisonSlideUi.classList.toggle("hidden", mode !== "sliding");
    comparisonSlideDivider.classList.toggle("hidden", mode !== "sliding");

    comparisonSlider.value = String(comparisonState.sliderPercent);
    applySlidingClip();
    deps.onResizeCanvasToVideo();
  }

  /**
   * Thumb center travels along [thumb/2, track - thumb/2] (native range behavior).
   * Uses layout rects so divider + clip match the thumb even with subpixel / border-box.
   */
  function thumbCenterPercentOfViewer(): number {
    const v = comparisonState.sliderPercent;
    const sliderRect = comparisonSlider.getBoundingClientRect();
    const rootRect = viewerComparisonRoot.getBoundingClientRect();
    const trackW = sliderRect.width;
    const rootW = rootRect.width;
    if (trackW <= 0 || rootW <= 0) return v;

    const tw = Math.min(COMPARISON_SLIDER_THUMB_PX, trackW);
    const centerInSlider = (v / 100) * Math.max(0, trackW - tw) + tw / 2;
    const centerDoc = sliderRect.left + centerInSlider;
    const pct = ((centerDoc - rootRect.left) / rootW) * 100;
    return Math.min(100, Math.max(0, pct));
  }

  function applySlidingClip() {
    if (comparisonState.mode !== "sliding") {
      comparisonOutputWrap.style.clipPath = "";
      viewerComparisonRoot.style.removeProperty("--compare-split");
      return;
    }
    const pct = thumbCenterPercentOfViewer();
    comparisonOutputWrap.style.clipPath = `inset(0 0 0 ${pct}%)`;
    viewerComparisonRoot.style.setProperty("--compare-split", `${pct}%`);
  }

  comparisonOffBtn.addEventListener("click", () => setMode("off"));
  comparisonSideBtn.addEventListener("click", () => setMode("sideBySide"));
  comparisonSlideBtn.addEventListener("click", () => setMode("sliding"));

  comparisonSlider.addEventListener("input", () => {
    comparisonState.sliderPercent = Number(comparisonSlider.value);
    applySlidingClip();
  });

  if (typeof ResizeObserver !== "undefined") {
    const ro = new ResizeObserver(() => {
      if (comparisonState.mode === "sliding") applySlidingClip();
    });
    ro.observe(viewerComparisonRoot);
    ro.observe(comparisonSlider);
  }

  setMode(comparisonState.mode);

  return {
    syncComparisonSourceImage(src: string) {
      comparisonSourceImg.src = src;
    },
    clearComparisonSourceImage() {
      comparisonSourceImg.removeAttribute("src");
    },
    refreshComparisonVisibility() {
      setMode(comparisonState.mode);
    },
  };
}
