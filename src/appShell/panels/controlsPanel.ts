import {
  MONO_BUTTON_CLASS,
  PANEL_CLASS,
  PARAM_PRESET_CHOOSER_CLASS,
} from "../uiClasses";
import {
  damageRangeControls,
  encodeRangeControls,
  toggleControls,
} from "../configs";
import {
  renderDatamoshControl,
  renderRangeControl,
  renderSectionLabel,
  renderToggleControl,
} from "../renderPrimitives";

export function renderControlsPanel(): string {
    const encodeControls = [
    renderRangeControl(encodeRangeControls[0]), // Quality
    renderRangeControl(encodeRangeControls[1]), // Resolution
  ].join("");

  const dctControls = [
    renderRangeControl(damageRangeControls[2]), // Chaos
    renderRangeControl(damageRangeControls[4]), // Posterize
    renderRangeControl(encodeRangeControls[2]), // Ringing
    renderRangeControl(damageRangeControls[6]), // DC Step
    renderToggleControl(toggleControls[2], "-mt-0.5"), // Invert DCT
  ].join("");

  const blockControls = [
    renderRangeControl(damageRangeControls[0]), // Dropout
    renderRangeControl(damageRangeControls[1]), // HS-Block
    renderDatamoshControl(), // Datamosh
  ].join("");

  const colorControls = [
    renderRangeControl(damageRangeControls[3]), // Color Bleed
    renderToggleControl(toggleControls[0], "-mt-0.5"), // Color Drift
    renderRangeControl(damageRangeControls[7]), // Lock Chroma
  ].join("");

  const feedbackControls = [
    renderRangeControl(damageRangeControls[5]), // Feedback
    renderToggleControl(toggleControls[1], "-mt-0.5"), // Feedback Pre-Pass
  ].join("");

  const bitstreamControls = [
    renderRangeControl(damageRangeControls[8]), // Bit Desync
    renderRangeControl(damageRangeControls[9]), // Bit Shift
    renderRangeControl(damageRangeControls[10]), // Bit Corrupt
  ].join("");

  return `
      <aside id="controls-panel-aside" class="flex h-full max-h-full min-h-0 min-w-0 max-lg:max-h-full flex-col overflow-hidden lg:h-full lg:min-h-0 lg:w-auto lg:max-w-none lg:shrink-0 lg:self-stretch lg:max-h-full" aria-label="Parameters">
        <div id="controls-panel-inert-scope" class="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        <section class="${PANEL_CLASS}">
          <header
            class="sticky top-0 z-[1] -mx-2 shrink-0 bg-white dark:bg-panel border-b-2 border-black dark:border-white mb-1 lg:-mx-1.5 lg:mb-0.5">
            <div class="h-1 w-full bg-black dark:bg-white" aria-hidden="true"></div>
            <div class="px-2 pt-2 pb-1.5 lg:px-1.5 lg:pt-1.5 lg:pb-1">
              <div class="flex flex-col gap-1.5 min-w-0">
                <div class="flex gap-1.5 w-full min-w-0 items-stretch">
                  <button type="button" id="preset-manage-btn" title="Save, load, and manage presets"
                    class="flex-1 min-w-0 ${MONO_BUTTON_CLASS} whitespace-normal text-center leading-tight">
                    SAVE/LOAD PRESET
                  </button>
                  <button type="button" id="reset-params" title="Reset all parameters to defaults"
                    class="shrink-0 ${MONO_BUTTON_CLASS} self-stretch">
                    RESET
                  </button>
                </div>
                <div class="w-full min-w-0">
                  <label for="preset-chooser" class="sr-only">Preset chooser</label>
                  <select id="preset-chooser"
                    class="${PARAM_PRESET_CHOOSER_CLASS}">
                    <option value="__current__">Current</option>
                    <option value="__defaults__">Defaults</option>
                  </select>
                </div>
              </div>
            </div>
          </header>

          ${renderSectionLabel("JPEG", "mb-1 lg:mb-0.5")}
          <div class="flex flex-col gap-2 lg:gap-1">
            ${encodeControls}
          </div>

          ${renderSectionLabel("Frequencies (DCT)", "mb-1 mt-2.5 lg:mb-0.5 lg:mt-1.5")}
          <div class="flex flex-col gap-2 lg:gap-1">
            ${dctControls}
          </div>

          ${renderSectionLabel("Blocks & Motion", "mb-1 mt-2.5 lg:mb-0.5 lg:mt-1.5")}
          <div class="flex flex-col gap-2 lg:gap-1">
            ${blockControls}
          </div>

          ${renderSectionLabel("Color", "mb-1 mt-2.5 lg:mb-0.5 lg:mt-1.5")}
          <div class="flex flex-col gap-2 lg:gap-1">
            ${colorControls}
          </div>

          ${renderSectionLabel("Temporal Feedback", "mb-1 mt-2.5 lg:mb-0.5 lg:mt-1.5")}
          <div class="flex flex-col gap-2 lg:gap-1">
            ${feedbackControls}
          </div>

          ${renderSectionLabel("Bitstream", "mb-1 mt-2.5 lg:mb-0.5 lg:mt-1.5")}
          <div class="flex flex-col gap-2 lg:gap-1">
            ${bitstreamControls}
          </div>
        </section>
        </div>
        <button
          type="button"
          id="clear-transcode-cache-btn"
          title="Remove locally cached transcoded MP4s from this browser (does not affect playback until you reload the same file)"
          class="shrink-0 w-full border-t-2 border-black dark:border-white bg-white dark:bg-panel px-2 py-1.5 lg:px-1.5 ${MONO_BUTTON_CLASS} text-[10px] leading-tight">
          CLEAR SAVED TRANSCODES
        </button>
      </aside>`;
}
