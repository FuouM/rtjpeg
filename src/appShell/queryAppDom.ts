/**
 * One-shot queries for nodes rendered by `renderAppShell()`.
 * Throws on missing ids so startup fails fast instead of with scattered null errors.
 */

function req<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) {
    throw new Error(`[rtjpeg] Missing required DOM node #${id}`);
  }
  return el as T;
}

export interface AppDom {
  videoUpload: HTMLInputElement;
  sourceVideo: HTMLVideoElement;
  outputCanvas: HTMLCanvasElement;
  qualitySlider: HTMLInputElement;
  qualityVal: HTMLSpanElement;
  scaleSlider: HTMLInputElement;
  scaleVal: HTMLSpanElement;
  chromaSelect: HTMLSelectElement;
  glitchSlider: HTMLInputElement;
  glitchVal: HTMLSpanElement;
  moshSlider: HTMLInputElement;
  moshVal: HTMLSpanElement;
  datamoshSlider: HTMLInputElement;
  datamoshVal: HTMLSpanElement;
  corruptSlider: HTMLInputElement;
  corruptVal: HTMLSpanElement;
  ringingSlider: HTMLInputElement;
  ringingVal: HTMLSpanElement;
  chromaBleedSlider: HTMLInputElement;
  chromaBleedVal: HTMLSpanElement;
  bitCrushSlider: HTMLInputElement;
  bitCrushVal: HTMLSpanElement;
  echoSlider: HTMLInputElement;
  echoVal: HTMLSpanElement;
  dcStepSlider: HTMLInputElement;
  dcStepVal: HTMLSpanElement;
  phaseShiftSlider: HTMLInputElement;
  phaseShiftVal: HTMLSpanElement;
  phaseShiftCanvas: HTMLCanvasElement;
  phaseShiftCtx: CanvasRenderingContext2D;
  echoBeforeToggle: HTMLInputElement;
  driftToggle: HTMLInputElement;
  invertDctToggle: HTMLInputElement;
  lockChromaSlider: HTMLInputElement;
  lockChromaVal: HTMLSpanElement;
  huffmanDesyncSlider: HTMLInputElement;
  huffmanDesyncVal: HTMLSpanElement;
  huffmanCorruptSlider: HTMLInputElement;
  huffmanCorruptVal: HTMLSpanElement;
  resetParamsBtn: HTMLButtonElement;
  presetChooser: HTMLSelectElement;
  presetManageBtn: HTMLButtonElement;
  clearTranscodeCacheBtn: HTMLButtonElement;
  seedInput: HTMLInputElement;
  exportBtn: HTMLButtonElement;
  renderBtn: HTMLButtonElement;
  refreshMoshBtn: HTMLButtonElement;
  copyFrameBtn: HTMLButtonElement;
  downloadFrameBtn: HTMLButtonElement;
  liveExportPicker: HTMLDivElement;
  liveExportPickerSize: HTMLParagraphElement;
  liveExportWebmBtn: HTMLButtonElement;
  liveExportMp4Btn: HTMLButtonElement;
  liveExportCancelBtn: HTMLButtonElement;
  playPauseBtn: HTMLButtonElement;
  frameStepPrevBtn: HTMLButtonElement;
  frameStepNextBtn: HTMLButtonElement;
  seekSlider: HTMLInputElement;
  timeDisplay: HTMLSpanElement;
  cachingText: HTMLSpanElement;
  timelineCanvas: HTMLCanvasElement;
  timelineCtx: CanvasRenderingContext2D;
  presetModal: HTMLDivElement;
  changelogModal: HTMLDivElement;
  changelogCloseBtn: HTMLButtonElement;
  changelogHeaderBtn: HTMLButtonElement;
  presetCloseBtn: HTMLButtonElement;
  presetStatus: HTMLParagraphElement;
  presetNameInput: HTMLInputElement;
  presetSaveBtn: HTMLButtonElement;
  presetUpdateBtn: HTMLButtonElement;
  presetDeleteBtn: HTMLButtonElement;
  presetExportText: HTMLTextAreaElement;
  presetDownloadJsonBtn: HTMLButtonElement;
  presetCopyBase64Btn: HTMLButtonElement;
  presetQrImage: HTMLImageElement;
  presetCopyQrBtn: HTMLButtonElement;
  presetSaveQrBtn: HTMLButtonElement;
  presetImportText: HTMLTextAreaElement;
  presetImportBtn: HTMLButtonElement;
  presetImportFileBtn: HTMLButtonElement;
  presetImportFileInput: HTMLInputElement;
  presetCopyLinkBtn: HTMLButtonElement;
  presetShareLinkBtn: HTMLButtonElement;
  presetImportPasteBtn: HTMLButtonElement;
  presetImportQrBtn: HTMLButtonElement;
  presetImportQrInput: HTMLInputElement;
  fpsDisplay: HTMLParagraphElement;
  welcomeSampleOverlay: HTMLDivElement;
  controlsPanelAside: HTMLElement;
  /** Preset + sliders; receives `inert` while welcome overlay is open (clear-transcode stays outside). */
  controlsPanelInertScope: HTMLElement;
  flowPanelAside: HTMLElement;
  viewerTransport: HTMLElement;
  tryExampleVideoBtn: HTMLButtonElement;
  welcomeUploadDropzone: HTMLDivElement;
  headerVideoUploadDropzone: HTMLDivElement;
  flowCanvas: HTMLCanvasElement;
  flowToggleBtn: HTMLButtonElement;
  flowClearBtn: HTMLButtonElement;
  flowLabel: HTMLElement;
  viewerComparisonRoot: HTMLElement;
  comparisonSourceWrap: HTMLElement;
  comparisonOutputWrap: HTMLElement;
  comparisonSlideDivider: HTMLElement;
  comparisonSlideUi: HTMLElement;
  comparisonSlider: HTMLInputElement;
  comparisonOffBtn: HTMLButtonElement;
  comparisonSideBtn: HTMLButtonElement;
  comparisonSlideBtn: HTMLButtonElement;
  comparisonSourceImg: HTMLImageElement;
}

export function queryAppDom(): AppDom {
  const timelineCanvas = req<HTMLCanvasElement>("timeline-canvas");
  const timelineCtx = timelineCanvas.getContext("2d");
  if (!timelineCtx) {
    throw new Error("[rtjpeg] Missing 2D context for #timeline-canvas");
  }

  const phaseShiftCanvas = req<HTMLCanvasElement>("phase-shift-canvas");
  const phaseShiftCtx = phaseShiftCanvas.getContext("2d");
  if (!phaseShiftCtx) {
    throw new Error("[rtjpeg] Missing 2D context for #phase-shift-canvas");
  }

  return {
    videoUpload: req("video-upload"),
    sourceVideo: req("source-video"),
    outputCanvas: req("output-canvas"),
    qualitySlider: req("quality-slider"),
    qualityVal: req("quality-val"),
    scaleSlider: req("scale-slider"),
    scaleVal: req("scale-val"),
    chromaSelect: req("chroma-select"),
    glitchSlider: req("glitch-slider"),
    glitchVal: req("glitch-val"),
    moshSlider: req("mosh-slider"),
    moshVal: req("mosh-val"),
    datamoshSlider: req("datamosh-slider"),
    datamoshVal: req("datamosh-val"),
    corruptSlider: req("corrupt-slider"),
    corruptVal: req("corrupt-val"),
    ringingSlider: req("ringing-slider"),
    ringingVal: req("ringing-val"),
    chromaBleedSlider: req("chroma-bleed-slider"),
    chromaBleedVal: req("chroma-bleed-val"),
    bitCrushSlider: req("bit-crush-slider"),
    bitCrushVal: req("bit-crush-val"),
    echoSlider: req("echo-slider"),
    echoVal: req("echo-val"),
    dcStepSlider: req("dc-step-slider"),
    dcStepVal: req("dc-step-val"),
    phaseShiftSlider: req("phase-shift-slider"),
    phaseShiftVal: req("phase-shift-val"),
    phaseShiftCanvas,
    phaseShiftCtx,
    echoBeforeToggle: req("echo-before-toggle"),
    driftToggle: req("drift-toggle"),
    resetParamsBtn: req("reset-params"),
    presetChooser: req("preset-chooser"),
    presetManageBtn: req("preset-manage-btn"),
    clearTranscodeCacheBtn: req("clear-transcode-cache-btn"),
    seedInput: req("seed-input"),
    exportBtn: req("export-btn"),
    renderBtn: req("render-btn"),
    refreshMoshBtn: req("refresh-mosh"),
    copyFrameBtn: req("copy-frame-btn"),
    downloadFrameBtn: req("download-frame-btn"),
    liveExportPicker: req("live-export-picker"),
    liveExportPickerSize: req("live-export-picker-size"),
    liveExportWebmBtn: req("live-export-webm-btn"),
    liveExportMp4Btn: req("live-export-mp4-btn"),
    liveExportCancelBtn: req("live-export-cancel-btn"),
    playPauseBtn: req("play-pause-btn"),
    frameStepPrevBtn: req("frame-step-prev-btn"),
    frameStepNextBtn: req("frame-step-next-btn"),
    seekSlider: req("seek-slider"),
    timeDisplay: req("time-display"),
    cachingText: req("caching-text"),
    timelineCanvas,
    timelineCtx,
    presetModal: req("preset-modal"),
    changelogModal: req("changelog-modal"),
    changelogCloseBtn: req("changelog-close-btn"),
    changelogHeaderBtn: req("changelog-header-btn"),
    presetCloseBtn: req("preset-close-btn"),
    presetStatus: req("preset-status"),
    presetNameInput: req("preset-name-input"),
    presetSaveBtn: req("preset-save-btn"),
    presetUpdateBtn: req("preset-update-btn"),
    presetDeleteBtn: req("preset-delete-btn"),
    presetExportText: req("preset-export-text"),
    presetDownloadJsonBtn: req("preset-download-json-btn"),
    presetCopyBase64Btn: req("preset-copy-base64-btn"),
    presetQrImage: req("preset-qr-image"),
    presetCopyQrBtn: req("preset-copy-qr-btn"),
    presetSaveQrBtn: req("preset-save-qr-btn"),
    presetImportText: req("preset-import-text"),
    presetImportBtn: req("preset-import-btn"),
    presetImportFileBtn: req("preset-import-file-btn"),
    presetImportFileInput: req("preset-import-file-input"),
    presetCopyLinkBtn: req("preset-copy-link-btn"),
    presetShareLinkBtn: req("preset-share-link-btn"),
    presetImportPasteBtn: req("preset-import-paste-btn"),
    presetImportQrBtn: req("preset-import-qr-btn"),
    presetImportQrInput: req("preset-import-qr-input"),
    fpsDisplay: req("fps-display"),
    welcomeSampleOverlay: req("welcome-sample-overlay"),
    controlsPanelAside: req("controls-panel-aside"),
    controlsPanelInertScope: req("controls-panel-inert-scope"),
    flowPanelAside: req("flow-panel-aside"),
    viewerTransport: req("viewer-transport"),
    tryExampleVideoBtn: req("try-example-video-btn"),
    welcomeUploadDropzone: req("welcome-upload-dropzone"),
    headerVideoUploadDropzone: req("header-video-upload-dropzone"),
    flowCanvas: req("flow-canvas"),
    flowToggleBtn: req("flow-toggle-btn"),
    flowClearBtn: req("flow-clear-btn"),
    flowLabel: req("flow-label"),
    viewerComparisonRoot: req("viewer-comparison-root"),
    comparisonSourceWrap: req("comparison-source-wrap"),
    comparisonOutputWrap: req("comparison-output-wrap"),
    comparisonSlideDivider: req("comparison-slide-divider"),
    comparisonSlideUi: req("comparison-slide-ui"),
    comparisonSlider: req("comparison-slider"),
    comparisonOffBtn: req("comparison-off-btn"),
    comparisonSideBtn: req("comparison-side-btn"),
    comparisonSlideBtn: req("comparison-slide-btn"),
    comparisonSourceImg: req("comparison-source-img"),
    invertDctToggle: req("invert-dct-toggle"),
    lockChromaSlider: req("lock-chroma-slider"),
    lockChromaVal: req("lock-chroma-val"),
    huffmanDesyncSlider: req("huffman-desync-slider"),
    huffmanDesyncVal: req("huffman-desync-val"),
    huffmanCorruptSlider: req("huffman-corrupt-slider"),
    huffmanCorruptVal: req("huffman-corrupt-val"),
  };
}
