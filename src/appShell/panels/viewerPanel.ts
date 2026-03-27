import {
  MONO_BUTTON_CLASS,
  TRANSPORT_PLAY_PAUSE_BUTTON_CLASS,
  WELCOME_PRIMARY_CTA_CLASS,
  WELCOME_UPLOAD_LABEL_CLASS,
} from "../uiClasses";

export function renderViewerPanel(): string {
  return `
      <section
        id="viewer-panel"
        class="flex min-h-0 min-w-0 flex-1 flex-col max-lg:flex-none lg:h-full lg:max-h-full"
        aria-label="Preview">
        <div
          class="border-4 border-black dark:border-white bg-black dark:bg-[#000] p-0 relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden max-lg:flex-none max-lg:min-h-[min(38svh,16rem)] max-lg:max-[499px]:min-h-[min(22svh,8.5rem)]">
          <div
            id="viewer-comparison-root"
            data-comparison="off"
            class="viewer-comparison-root relative flex min-h-0 min-w-0 flex-1 flex-col">
            <div
              id="comparison-source-wrap"
              class="comparison-source-wrap min-h-0 min-w-0 items-center justify-center overflow-hidden">
              <video id="source-video" loop muted playsinline preload="none" class="hidden max-h-full max-w-full object-contain"></video>
              <img id="comparison-source-img" class="hidden max-h-full max-w-full object-contain" alt="" />
            </div>
            <div
              id="comparison-output-wrap"
              class="comparison-output-wrap flex min-h-0 min-w-0 flex-1 flex-col items-center justify-center">
              <canvas id="output-canvas" class="box-border min-h-0 w-full flex-1 basis-0 object-contain"></canvas>
            </div>
            <div
              id="comparison-slide-divider"
              class="comparison-slide-divider pointer-events-none absolute top-0 bottom-0 z-[15] hidden w-0.5 bg-white"
              aria-hidden="true"></div>
            <div
              id="comparison-slide-ui"
              class="comparison-slide-ui absolute bottom-2 left-0 right-0 z-[20] hidden flex flex-col gap-0.5">
              <label
                for="comparison-slider"
                class="font-mono text-[7px] font-black uppercase tracking-[0.15em] text-white/90 pl-2">Compare split</label>
              <input
                type="range"
                id="comparison-slider"
                min="0"
                max="100"
                value="50"
                step="0.5"
                class="comparison-slider w-full"
                aria-label="Comparison split position" />
            </div>
          </div>
          <div class="pointer-events-none absolute top-0 right-0 z-[40] p-2">
            <p id="fps-display"
              class="pointer-events-auto font-mono px-2 py-0.5 border-2 border-white bg-black text-[10px] font-black uppercase tracking-[0.1em] text-white tabular-nums whitespace-nowrap cursor-pointer"
              aria-live="polite"
              title="Click to toggle between FPS and Frame Render Time">- FPS</p>
          </div>
          <div id="welcome-sample-overlay"
            class="absolute inset-0 z-[50] flex items-center justify-center bg-black/88 p-4"
            role="dialog"
            aria-labelledby="welcome-sample-title"
            aria-describedby="welcome-sample-desc">
            <div
              class="max-w-[min(100%,22rem)] border-2 border-white bg-black px-5 py-4 text-center">
              <p id="welcome-sample-title"
                class="font-oswald text-lg tracking-[0.06em] uppercase leading-snug sm:text-2xl text-white">
                Welcome to <span class="text-[#2eff46]">RT</span>_JPEG!
              </p>
              <p id="welcome-sample-desc"
                class="mt-2.5 font-mono text-[11px] font-medium normal-case tracking-normal text-white/85 leading-relaxed">
                Load a video or image from the bar up top, pick a file below, or try the sample.<br />
                Nothing leaves your browser.
              </p>
              <button type="button" id="try-example-video-btn"
                class="${WELCOME_PRIMARY_CTA_CLASS}">
                Play sample video
              </button>
              <div id="welcome-upload-dropzone"
                class="mt-4 w-full border-2 border-dashed border-white/45 px-3 py-3 transition-colors">
                <label for="video-upload"
                  class="${WELCOME_UPLOAD_LABEL_CLASS}">
                  Choose video or image
                </label>
                <p class="mt-2.5 font-mono text-[10px] font-medium normal-case tracking-normal text-white/70 leading-snug">
                  Or drag and drop a file here
                </p>
              </div>
            </div>
          </div>
        </div>

        <div
          id="viewer-transport"
          class="border-4 border-t-0 border-black dark:border-white bg-white dark:bg-panel p-3 relative shrink-0 max-lg:p-2">
          <div class="flex flex-col gap-3 max-lg:gap-2">
            <div class="flex min-w-0 items-center gap-2 max-lg:gap-1.5">
              <button id="play-pause-btn"
                type="button"
                class="${TRANSPORT_PLAY_PAUSE_BUTTON_CLASS}">
                PAUSE
              </button>
              <div
                class="flex min-w-0 flex-1 flex-wrap items-center justify-center gap-1 max-lg:gap-0.5"
                role="group"
                aria-label="Source vs processed comparison">
                <span class="font-mono text-[7px] font-black uppercase tracking-[0.15em] text-subtitle leading-none max-[380px]:hidden">Compare</span>
                <button type="button" id="comparison-off-btn"
                  class="${MONO_BUTTON_CLASS} shrink-0"
                  title="Show processed output only"
                  aria-pressed="true">Output</button>
                <button type="button" id="comparison-side-btn"
                  class="${MONO_BUTTON_CLASS} shrink-0"
                  title="Source and processed side by side"
                  aria-pressed="false">Side</button>
                <button type="button" id="comparison-slide-btn"
                  class="${MONO_BUTTON_CLASS} shrink-0"
                  title="Drag split to compare source (left) and processed (right)"
                  aria-pressed="false">Slide</button>
              </div>
              <div class="flex shrink-0 flex-col items-end gap-0.5">
                <span id="time-display"
                  class="font-mono tabular-nums whitespace-pre text-[11px] font-black tracking-widest text-subtitle max-lg:text-[10px]">0:00 /
                  0:00  &middot;  -</span>
                <span id="caching-text" class="font-mono text-[9px] font-bold text-accent">CACHED: 0
                  FRAMES</span>
              </div>
            </div>
            <div class="relative w-full" style="height:28px">
              <canvas id="timeline-canvas" class="absolute inset-0 w-full h-full cursor-pointer"
                style="touch-action:none"></canvas>
              <input type="range" id="seek-slider" min="0" max="100" value="0" step="0.01" class="sr-only"
                aria-label="Seek" />
              <canvas id="cache-canvas" class="hidden" width="1" height="1"></canvas>
            </div>
          </div>
        </div>
      </section>`;
}
