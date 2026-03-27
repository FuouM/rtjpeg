import { APP_VERSION } from "../appVersion";
import { MONO_BUTTON_CLASS, PARAM_FILE_INPUT_CLASS } from "./uiClasses";
import { renderHelpButton } from "./renderPrimitives";
import { renderControlsPanel } from "./panels/controlsPanel";
import { renderFlowPanel } from "./panels/flowPanel";
import { renderChangelogModal } from "./panels/changelogModal";
import { renderPresetModal } from "./panels/presetModal";
import { renderViewerPanel } from "./panels/viewerPanel";

export function renderAppShell(): void {
  const root = document.getElementById("app-root");
  if (!root) {
    throw new Error("Missing #app-root mount node");
  }

  root.innerHTML = `
  <div id="webgpu-unsupported-banner"
    class="hidden w-full shrink-0 z-[100] border-b-4 border-black dark:border-white bg-[#ff3333] text-black px-3 py-2 shadow-[0_4px_0_0_rgba(0,0,0,1)] dark:shadow-[0_4px_0_0_rgba(255,255,255,1)]"
    role="alert">
    <p class="font-mono text-xs font-black uppercase tracking-[0.12em] leading-snug text-center max-w-4xl mx-auto">
      <span class="block sm:inline">WebGPU unavailable - </span><span id="webgpu-unsupported-detail">This app needs a browser with WebGPU (e.g. current Chrome or Edge).</span>
    </p>
  </div>

  <div id="app" class="mx-auto z-10 flex h-full min-h-0 w-full max-w-[1920px] flex-1 flex-col gap-1.5 overflow-hidden pb-1.5 pl-[max(0.5rem,env(safe-area-inset-left))] pr-[max(0.5rem,env(safe-area-inset-right))] pt-[max(0.375rem,env(safe-area-inset-top))] max-lg:min-h-0 max-lg:gap-1 max-lg:pb-1 max-lg:pt-1 lg:min-h-0 lg:gap-1 lg:pb-1">
    <header
      class="app-top-header flex-shrink-0 border-2 border-black dark:border-white bg-white dark:bg-panel py-1 px-2 brutal-shadow relative max-lg:py-0.5 max-lg:px-1.5">
      <div class="absolute top-0 left-0 w-1 h-full bg-highlight"></div>
      <div class="flex flex-wrap items-center gap-x-2 gap-y-1 pl-2.5 pr-0.5 max-lg:gap-x-1.5 max-lg:gap-y-0.5 max-lg:pl-2 max-lg:pr-0.5 lg:flex-nowrap">
        <div class="flex flex-wrap items-center gap-1.5 shrink-0 max-lg:gap-1 min-w-0 lg:flex-nowrap">
          <h1 class="font-oswald text-lg tracking-normal uppercase leading-tight lg:text-3xl lg:tracking-tighter lg:leading-none shrink-0 whitespace-nowrap overflow-visible">
            <span style="color: #2eff46">RT</span><span class="title-jpeg-glitch">_JPEG</span>
          </h1>
          <div class="hidden sm:flex flex-col gap-0 leading-none shrink-0" role="group" aria-label="Runtime">
            <span class="font-mono text-[9px] font-black uppercase tracking-[0.12em] text-black dark:text-muted">WebGPU</span>
            <span class="font-mono text-[9px] font-black uppercase tracking-[0.12em] text-black dark:text-muted tabular-nums">v${APP_VERSION}</span>
          </div>
          ${renderHelpButton(
            `RT_JPEG is a real-time JPEG artifact simulator. It uses WebGPU to process video/images through a custom JPEG-like pipeline:

• Input frames are uploaded to VRAM.
• Data is converted to YCbCr, subsampled, and divided into 8x8 blocks for DCT.
• Artifacts are injected by zeroing coefficients, jittering AC values, or corrupting bitstreams.
• Motion vectors (Auto or Drawn) trigger temporal "mosh", pulling data from previous frames.
• The result is reconstructed via Inverse-DCT and rendered to the canvas.`,
            "About RT_JPEG",
            "shrink-0",
          )}
          <div id="header-video-upload-dropzone"
            class="min-w-0 w-full max-w-full basis-[8rem] flex-1 max-lg:basis-full sm:flex-none sm:shrink-0 sm:max-lg:w-[min(22rem,100%)] sm:max-lg:max-w-[min(22rem,100%)] lg:w-[min(16rem,100%)] lg:max-w-[min(16rem,100%)] transition-[box-shadow,background-color]">
            <input type="file" id="video-upload" accept="video/*,image/*" title="Load a video or image file"
              aria-label="Load video or image file"
              class="${PARAM_FILE_INPUT_CLASS}" />
          </div>
          <div
            class="hidden lg:flex flex-col gap-0.5 shrink-0 border-l-2 border-black dark:border-white pl-2 ml-0.5"
            role="group"
            aria-label="Wide screen: panel columns">
            <span class="font-mono text-[9px] font-black uppercase tracking-[0.1em] text-subtitle leading-none">Panels</span>
            <div class="flex flex-nowrap items-center gap-1">
              <button type="button" id="ws-layout-split-btn"
                class="${MONO_BUTTON_CLASS} shrink-0"
                title="Parameters left, flow right (default)"
                aria-pressed="true">Split</button>
              <button type="button" id="ws-layout-both-left-btn"
                class="${MONO_BUTTON_CLASS} shrink-0"
                title="Parameters and flow side-by-side on the left"
                aria-pressed="false">2 left</button>
              <button type="button" id="ws-layout-both-right-btn"
                class="${MONO_BUTTON_CLASS} shrink-0"
                title="Parameters and flow side-by-side on the right"
                aria-pressed="false">2 right</button>
            </div>
          </div>
        </div>
        <div
          class="ml-auto flex min-w-0 max-w-full max-sm:w-full max-sm:flex-col max-sm:gap-y-0.5 max-sm:text-left sm:flex-col sm:gap-0.5 sm:w-auto sm:shrink-0 sm:items-end sm:text-right">
          <div
            class="max-sm:flex max-sm:min-w-0 max-sm:w-full max-sm:flex-row max-sm:flex-wrap max-sm:items-center max-sm:gap-x-2 sm:contents">
            <div
              class="flex flex-wrap items-center gap-x-1.5 gap-y-0 font-mono font-black uppercase tracking-[0.08em] text-[9px] max-sm:gap-x-2 max-sm:text-[10px] max-sm:justify-start sm:justify-end sm:text-[9px]">
              <a href="https://github.com/FuouM/rtjpeg" target="_blank" rel="noopener noreferrer"
                class="text-black dark:text-white underline decoration-1 underline-offset-2 decoration-highlight transition-colors hover:text-highlight dark:hover:text-highlight max-sm:inline-flex max-sm:items-center max-sm:justify-start max-sm:py-0.5 max-sm:decoration-2">
                GitHub
              </a>
              <span class="text-subtitle max-sm:hidden select-none" aria-hidden="true">&middot;</span>
              <a href="https://github.com/FuouM/rtjpeg/issues" target="_blank" rel="noopener noreferrer"
                class="text-black dark:text-white underline decoration-1 underline-offset-2 decoration-highlight transition-colors hover:text-highlight dark:hover:text-highlight max-sm:inline-flex max-sm:items-center max-sm:justify-center max-sm:px-1 max-sm:py-0.5 max-sm:decoration-2">
                Issues
              </a>
              <span class="text-subtitle max-sm:hidden select-none" aria-hidden="true">&middot;</span>
              <button type="button" id="changelog-header-btn"
                title="View release notes for this version"
                aria-label="Open changelog"
                class="text-black dark:text-white underline decoration-1 underline-offset-2 decoration-highlight transition-colors hover:text-highlight dark:hover:text-highlight max-sm:inline-flex max-sm:items-center max-sm:justify-start max-sm:py-0.5 max-sm:decoration-2 font-mono font-black uppercase tracking-[0.08em] text-[9px] max-sm:text-[10px] sm:text-[9px]">
                Changelog
              </button>
            </div>
            <p
              class="font-mono text-[9px] font-bold uppercase tracking-[0.06em] text-subtitle leading-snug max-sm:inline-flex max-sm:items-center max-sm:text-[9px] max-sm:leading-tight sm:block sm:text-[9px]">
              Vibecoded by a real human <span class="text-red-600 dark:text-red-500">&lt;3</span>
            </p>
          </div>
          <p
            class="max-sm:w-full font-mono text-[9px] font-bold uppercase tracking-[0.05em] text-subtitle leading-tight max-sm:text-[9px] max-sm:leading-tight sm:leading-snug sm:text-[9px] max-[469px]:whitespace-normal min-[470px]:max-sm:whitespace-nowrap sm:whitespace-normal lg:whitespace-nowrap">
            Nothing you load is uploaded; <br class="hidden max-[469px]:block sm:block lg:hidden" aria-hidden="true" />processing stays in your browser.
          </p>
        </div>
      </div>
    </header>

    <main id="app-main" data-ws-layout="split" class="flex min-h-0 flex-1 flex-col gap-2 overflow-hidden pb-[max(0.5rem,env(safe-area-inset-bottom))] max-lg:gap-1 max-lg:overflow-y-auto max-lg:overflow-x-hidden max-lg:pb-1 lg:grid lg:h-full lg:min-h-0 lg:items-stretch lg:gap-1.5 lg:pb-1.5">
      ${renderViewerPanel()}
      <div
        class="dock-panels shrink-0 grid w-full min-h-0 gap-1.5 sm:gap-2 max-lg:grid-cols-2 max-lg:max-[499px]:grid-cols-1 max-lg:min-h-0 max-lg:h-[min(40svh,21rem)] max-lg:max-[499px]:h-[min(44svh,24rem)] max-sm:max-lg:max-[499px]:h-[min(56svh,32rem)] max-lg:max-[499px]:grid-rows-[minmax(0,1fr)_minmax(0,1fr)] max-lg:overflow-hidden lg:contents lg:h-auto lg:max-h-none lg:overflow-visible"
        role="region"
        aria-label="Parameters and flow">
        ${renderControlsPanel()}
        ${renderFlowPanel()}
      </div>
    </main>

    ${renderPresetModal()}
    ${renderChangelogModal()}
  </div>`;
}
