import type {
  RangeControlConfig,
  SelectControlConfig,
  ToggleControlConfig,
} from "./types";
import {
  MONO_BUTTON_COMPACT_CLASS,
  PARAM_SELECT_FLEX_CLASS,
} from "./uiClasses";

export function renderHelpButton(
  title: string,
  ariaLabel: string,
  extraClass = "",
): string {
  const className = ["param-help", extraClass].filter(Boolean).join(" ");
  return `<button type="button" class="${className}" title="${title}" aria-label="${ariaLabel}">?</button>`;
}

export function renderRangeControl(control: RangeControlConfig): string {
  const stepAttr = control.step ? ` step="${control.step}"` : "";
  return `
            <div class="flex flex-col gap-0">
              <label for="${control.id}"
                class="font-mono text-[10px] font-black uppercase tracking-[0.12em] flex justify-between gap-2 items-baseline leading-none">
                <span class="flex items-baseline gap-1 min-w-0 flex-1">
                  <span class="text-subtitle truncate">${
                    control.labelHtml
                  }</span>
                  ${renderHelpButton(control.helpTitle, control.helpAriaLabel)}
                </span>
                <span class="text-accent dark:text-accent font-bold tabular-nums shrink-0"><span id="${
                  control.valueId
                }">${control.valueText}</span>${
                  control.valueSuffixHtml ?? ""
                }</span>
              </label>
              <input type="range" id="${control.id}" min="${
                control.min
              }" max="${control.max}" value="${control.value}"${stepAttr}
                class="param-range w-full appearance-none cursor-pointer" />
            </div>`;
}

export function renderSelectControl(control: SelectControlConfig): string {
  const options = control.options
    .map(
      (option) =>
        `<option value="${option.value}"${option.selected ? " selected" : ""}>${
          option.label
        }</option>`,
    )
    .join("");

  return `
            <div class="flex flex-col gap-1.5 shrink-0">
              ${renderSectionLabel(control.label, "pb-0.5")}
              <div class="flex items-center gap-1.5 shrink-0">
                <label for="${control.id}" class="sr-only">${
                  control.label
                }</label>
                <select id="${control.id}"
                  class="${PARAM_SELECT_FLEX_CLASS}">
                  ${options}
                </select>
                ${renderHelpButton(
                  control.helpTitle,
                  control.helpAriaLabel,
                  "shrink-0",
                )}
              </div>
            </div>`;
}

export function renderToggleControl(
  control: ToggleControlConfig,
  className = "",
): string {
  return `
            <div class="flex items-center gap-1 min-h-[1.25rem] ${className}">
              <label
                class="font-mono text-[10px] font-black uppercase tracking-[0.12em] flex items-center gap-2 cursor-pointer min-w-0 flex-1">
                <input type="checkbox" id="${control.id}"
                  class="w-3.5 h-3.5 shrink-0 cursor-pointer accent-black dark:accent-white border-2 border-black dark:border-white" />
                <span class="text-subtitle">${control.label}</span>
              </label>
              ${renderHelpButton(
                control.helpTitle,
                control.helpAriaLabel,
                "shrink-0",
              )}
            </div>`;
}

export function renderSectionLabel(title: string, className = ""): string {
  return `<p class="font-mono text-[8px] font-black uppercase tracking-[0.28em] text-subtitle border-b border-black/30 dark:border-white/25 pb-0.5 ${className}">${title}</p>`;
}

export function renderDatamoshControl(): string {
  return `
            <div class="flex flex-col gap-0">
              <div class="flex justify-between items-baseline gap-2 leading-none">
                <div class="flex items-baseline gap-1 min-w-0 flex-1">
                  <label for="datamosh-slider"
                    class="font-mono text-[10px] font-black uppercase tracking-[0.12em] text-subtitle leading-none truncate min-w-0">LK-Mosh</label>
                  ${renderHelpButton(
                    "Lucas-Kanade optical-flow datamosh: blocks follow motion; REF picks a new random pattern.",
                    "LK-Mosh: Lucas-Kanade optical flow datamosh; REF reseeds pattern",
                    "shrink-0",
                  )}
                </div>
                <div class="flex items-center gap-1 shrink-0">
                  <span id="datamosh-val"
                    class="font-mono text-[10px] font-bold text-accent dark:text-accent tabular-nums leading-none">0</span>
                  <button type="button" id="refresh-mosh" title="Reseed LK-Mosh pattern"
                    class="${MONO_BUTTON_COMPACT_CLASS}">RESEED</button>
                </div>
              </div>
              <input type="range" id="datamosh-slider" min="0" max="100" value="0"
                class="param-range w-full appearance-none cursor-pointer" />
            </div>`;
}
