import {
  MONO_BUTTON_CLASS,
  PARAM_INPUT_TEXT_CLASS,
  PARAM_TEXTAREA_CLASS,
} from "../uiClasses";
import { renderSectionLabel } from "../renderPrimitives";

export function renderPresetModal(): string {
  return `
    <div id="preset-modal"
      class="hidden fixed inset-0 z-[150] items-center justify-center bg-black/70 p-3"
      role="dialog"
      aria-modal="true"
      aria-labelledby="preset-modal-title">
      <div
        class="w-full max-w-[34rem] border-4 border-black dark:border-white bg-white dark:bg-panel max-h-[min(100%,42rem)] overflow-y-auto">
        <div class="h-1 w-full bg-black dark:bg-white" aria-hidden="true"></div>
        <div class="p-3 flex flex-col gap-3">
          <div class="flex items-center gap-2">
            <div class="min-w-0 flex-1">
              <h2 id="preset-modal-title"
                class="font-mono text-[10px] font-black uppercase tracking-[0.16em] text-black dark:text-white">Preset Manager</h2>
              <p id="preset-status" class="font-mono text-[8px] font-bold text-subtitle leading-snug">Save local presets or import/export safe preset data.</p>
            </div>
            <button type="button" id="preset-close-btn" title="Close preset manager"
              class="${MONO_BUTTON_CLASS} shrink-0">Close</button>
          </div>

          <div class="flex flex-col gap-1.5">
            ${renderSectionLabel("Preset Name", "pb-0")}
            <label for="preset-name-input" class="sr-only">Preset name</label>
            <input type="text" id="preset-name-input" maxlength="40" placeholder="Preset name"
              class="${PARAM_INPUT_TEXT_CLASS}" />
            <div class="flex flex-wrap gap-1.5">
              <button type="button" id="preset-save-btn" class="${MONO_BUTTON_CLASS}">Save New</button>
              <button type="button" id="preset-update-btn" class="${MONO_BUTTON_CLASS}">Update</button>
              <button type="button" id="preset-delete-btn" class="${MONO_BUTTON_CLASS}">Delete</button>
            </div>
          </div>

          <div class="flex flex-col gap-1.5">
            ${renderSectionLabel("Export", "pb-0")}
            <p class="font-mono text-[7px] text-subtitle leading-snug">
              <span class="font-black text-black dark:text-white">Link</span>
              — copy or share; opening it loads this preset.
              <span class="block mt-1">
                <span class="font-black text-black dark:text-white">QR</span>
                — encodes the same link; scanning opens the app (or use Decode QR on a screenshot).</span>
            </p>
            <label for="preset-export-text" class="sr-only">Preset export string</label>
            <textarea id="preset-export-text" readonly
              class="${PARAM_TEXTAREA_CLASS}"></textarea>
            <div class="flex flex-wrap gap-1.5">
              <button type="button" id="preset-download-json-btn" class="${MONO_BUTTON_CLASS}">JSON</button>
              <button type="button" id="preset-copy-base64-btn" class="${MONO_BUTTON_CLASS}">Copy Base64</button>
              <button type="button" id="preset-copy-link-btn" title="Copy URL with preset in the hash"
                class="${MONO_BUTTON_CLASS}">Copy Link</button>
              <button type="button" id="preset-share-link-btn" title="System share sheet (mobile)"
                class="${MONO_BUTTON_CLASS}">Share Link</button>
            </div>
            <img id="preset-qr-image" alt="Preset QR code" class="hidden w-full max-w-[12rem] self-center border-2 border-black dark:border-white bg-white p-2" />
            <div class="flex flex-wrap gap-1.5 justify-center">
              <button type="button" id="preset-copy-qr-btn" title="Copy QR code image to clipboard"
                class="${MONO_BUTTON_CLASS}">Copy QR</button>
              <button type="button" id="preset-save-qr-btn" title="Save QR code as PNG"
                class="${MONO_BUTTON_CLASS}">Save QR</button>
            </div>
          </div>

          <div class="flex flex-col gap-1.5">
            ${renderSectionLabel("Import", "pb-0")}
            <label for="preset-import-text" class="sr-only">Preset JSON or base64 string</label>
            <textarea id="preset-import-text" placeholder="Paste a preset JSON document or rtjpeg:preset:v1: string"
              class="${PARAM_TEXTAREA_CLASS}"></textarea>
            <div class="flex flex-wrap gap-1.5">
              <button type="button" id="preset-import-btn" class="${MONO_BUTTON_CLASS}">Import Text</button>
              <button type="button" id="preset-import-paste-btn" title="Paste preset from clipboard"
                class="${MONO_BUTTON_CLASS}">Paste</button>
              <button type="button" id="preset-import-file-btn" class="${MONO_BUTTON_CLASS}">Import JSON File</button>
              <button type="button" id="preset-import-qr-btn" title="Decode QR from a PNG/JPEG screenshot"
                class="${MONO_BUTTON_CLASS}">Decode QR</button>
            </div>
            <input type="file" id="preset-import-file-input" accept="application/json,.json" class="hidden" />
            <input type="file" id="preset-import-qr-input" accept="image/*" class="hidden" />
          </div>
        </div>
      </div>
    </div>`;
}
