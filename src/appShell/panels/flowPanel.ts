import {
  ACCENT_EXPORT_LIVE_CLASS,
  ACCENT_EXPORT_RENDER_CLASS,
  ACCENT_PICKER_MP4_CLASS,
  ACCENT_PICKER_WEBM_CLASS,
  MONO_BUTTON_CLASS,
  PANEL_CLASS,
  PARAM_INPUT_NUMBER_CLASS,
} from "../uiClasses";
import { chromaControl, phaseShiftControl } from "../configs";
import {
  renderHelpButton,
  renderSectionLabel,
  renderSelectControl,
  renderRangeControl,
} from "../renderPrimitives";

export function renderFlowPanel(): string {
  return `
      <aside id="flow-panel-aside" class="flex h-full max-h-full min-h-0 min-w-0 max-lg:max-h-full flex-col overflow-hidden lg:h-full lg:min-h-0 lg:w-auto lg:max-w-none lg:shrink-0 lg:self-stretch lg:max-h-full" aria-label="Flow controls">
        <section class="${PANEL_CLASS}">
          <header
            class="sticky top-0 z-[1] -mx-2 shrink-0 bg-white dark:bg-panel border-b-2 border-black dark:border-white mb-2 lg:-mx-1.5 lg:mb-1">
            <div class="h-1 w-full bg-black dark:bg-white" aria-hidden="true"></div>
            <div class="px-2 pt-2 pb-1.5 flex flex-col gap-1.5 min-w-0 lg:px-1.5 lg:pt-1.5 lg:pb-1 lg:gap-1">
              <div class="flex flex-wrap gap-1 justify-end items-center min-w-0">
                <button type="button" id="copy-frame-btn" title="Copy current preview frame to clipboard"
                  class="frame-action-btn ${MONO_BUTTON_CLASS} shrink-0">COPY FRAME</button>
                <button type="button" id="download-frame-btn" title="Download current preview as PNG"
                  class="frame-action-btn ${MONO_BUTTON_CLASS} shrink-0">DOWNLOAD FRAME</button>
              </div>
              <div class="flex flex-wrap gap-1 justify-end items-center min-w-0">
                <button type="button" id="flow-toggle-btn"
                  title="Toggle between AUTO (LK-computed) and DRAW (custom painted direction)"
                  class="${MONO_BUTTON_CLASS} shrink-0">Auto Flow</button>
                <button type="button" id="flow-clear-btn"
                  title="Clear drawn stroke and reset flow to zero"
                  class="${MONO_BUTTON_CLASS} shrink-0">CLEAR</button>
              </div>
            </div>
          </header>

          ${renderSectionLabel("Flow", "mb-1.5 lg:mb-0.5")}

          <div
            class="relative mx-auto w-full max-w-[min(100%,10.5rem)] aspect-square shrink-0 border-2 border-black dark:border-white box-border lg:aspect-auto lg:h-[min(100%,min(10rem,22svh))] lg:w-[min(100%,min(10rem,22svh))] lg:max-w-none">
            <canvas id="flow-canvas"
              class="absolute inset-0 h-full w-full"
              style="touch-action:none; display:block;"></canvas>
          </div>

          <p id="flow-label"
            class="mt-1.5 lg:mt-0.5 font-mono text-[9px] font-black tracking-[0.12em] text-center leading-none"
            style="color:rgba(255,255,255,0.35)">- - -</p>

          <p class="font-mono text-[7px] text-muted text-center uppercase tracking-[0.2em] mt-2 pt-1 border-t border-dashed border-black/40 dark:border-white/30 leading-tight lg:mt-1 lg:pt-0.5">
            Draw -&gt; direction to mosh</p>

          <p class="font-mono text-[7px] text-muted text-center uppercase tracking-[0.2em] mt-0.5 leading-tight lg:mt-0">
            Works with LK-Mosh slider</p>

          <div class="mt-3 pt-2 border-t-2 border-black dark:border-white flex flex-col gap-2 shrink-0 lg:mt-auto lg:pt-1 lg:gap-1.5">
            <div class="flex flex-col gap-1.5 shrink-0">
              ${renderSectionLabel("Phase Shift", "pb-0.5")}
              ${renderRangeControl(phaseShiftControl)}
              <div class="relative w-full h-10 border-2 border-black dark:border-white bg-brutalWhite dark:bg-[#111] box-border shrink-0">
                <canvas id="phase-shift-canvas" class="absolute inset-0 h-full w-full" style="display:block;"></canvas>
              </div>
            </div>
            ${renderSelectControl(chromaControl)}
            <div class="flex flex-col gap-1.5 shrink-0">
              ${renderSectionLabel("RNG Seed", "pb-0.5")}
              <div class="flex items-center gap-1.5 shrink-0">
                <label for="seed-input" class="sr-only">Seed</label>
                <input type="number" id="seed-input" value="-1" min="-1" step="1"
                  class="${PARAM_INPUT_NUMBER_CLASS}" />
                ${renderHelpButton(
                  "-1 = random per frame; 0+ = fixed deterministic seed",
                  "Seed: -1 random per frame; 0 or higher = fixed deterministic RNG",
                  "shrink-0",
                )}
              </div>
            </div>
            <div class="flex flex-col gap-1.5 shrink-0 pt-2 border-t-2 border-black dark:border-white lg:pt-1 lg:gap-1">
              ${renderSectionLabel("Output", "pb-0.5")}
              <p class="font-mono text-[11px] text-subtitle leading-snug lg:text-[10px] lg:leading-tight">
                <span class="font-black text-black dark:text-white">Live rec</span>
                - records the GPU preview in real time with a locked export size so the file stays stable.
                <span class="block mt-1.5 lg:mt-0.5">
                  <span class="font-black text-black dark:text-white">Render</span>
                  - walks the whole timeline offline with the current parameters and exports an MP4 when finished.</span>
              </p>
              <div class="flex gap-1.5 w-full lg:gap-1">
                <button type="button" id="export-btn" title="Record live preview to file"
                  class="${ACCENT_EXPORT_LIVE_CLASS}">
                  LIVE REC
                </button>
                <button type="button" id="render-btn" title="Render full video with current settings"
                  class="${ACCENT_EXPORT_RENDER_CLASS}">
                  RENDER
                </button>
              </div>
              <div id="live-export-picker" class="hidden flex flex-col gap-2 pt-2 mt-2 border-t-2 border-black dark:border-white"
                aria-hidden="true">
                ${renderSectionLabel("Live export format", "pb-0")}
                <p class="font-mono text-[10px] text-subtitle leading-snug">
                  Resolution locks when recording starts; params can change mid-take without resizing the file.
                </p>
                <p id="live-export-picker-size"
                  class="font-mono text-[9px] font-black uppercase tracking-[0.12em] text-accent dark:text-accent tabular-nums">
                  Locked Size: -
                </p>
                <div class="flex gap-1.5 w-full">
                  <button type="button" id="live-export-webm-btn"
                    class="${ACCENT_PICKER_WEBM_CLASS}">
                    WebM
                  </button>
                  <button type="button" id="live-export-mp4-btn"
                    class="${ACCENT_PICKER_MP4_CLASS}">
                    MP4
                  </button>
                </div>
                <button type="button" id="live-export-cancel-btn"
                  class="${MONO_BUTTON_CLASS} self-start">
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </section>
      </aside>`;
}
