/**
 * Shared Tailwind class strings for the brutal UI kit (string-template render pipeline).
 */

export const PANEL_CLASS =
  "param-panel border-4 border-black dark:border-white bg-white dark:bg-panel px-2 pb-2 pt-0 lg:px-1.5 lg:pb-1.5 brutal-shadow flex flex-col gap-0 relative flex-1 min-h-0 overflow-y-auto overflow-x-hidden";

const MONO_BRUTAL_BTN =
  "font-black uppercase border-2 border-black dark:border-white bg-black text-white dark:bg-white dark:text-black hover:bg-white hover:text-black dark:hover:bg-black dark:hover:text-white transition-colors cursor-pointer leading-none brutal-btn";

/** Sidebar, modals, comparison — compact but crisp mono */
export const MONO_BUTTON_CLASS = `font-mono text-[10px] tracking-[0.12em] ${MONO_BRUTAL_BTN} px-1.5 py-0.5`;

/** Tighter mono (e.g. RESEED) */
export const MONO_BUTTON_COMPACT_CLASS = `font-mono text-[9px] tracking-[0.12em] ${MONO_BRUTAL_BTN} px-1 py-0.5`;

export const TRANSPORT_PLAY_PAUSE_BUTTON_CLASS = `inline-flex w-[5.5rem] max-lg:w-[5rem] shrink-0 items-center justify-center font-mono text-[11px] font-black uppercase tracking-widest border-2 border-black dark:border-white bg-black text-white dark:bg-white dark:text-black px-2 py-1.5 hover:bg-white hover:text-black dark:hover:bg-black dark:hover:text-white transition-colors cursor-pointer leading-none brutal-btn max-lg:py-1`;

export const WELCOME_PRIMARY_CTA_CLASS =
  "mt-4 w-full font-mono text-[11px] font-black uppercase tracking-widest border-2 border-white bg-white text-black px-4 py-2 hover:bg-black hover:text-white transition-colors cursor-pointer leading-none brutal-btn";

export const WELCOME_UPLOAD_LABEL_CLASS =
  "block w-full cursor-pointer font-mono text-[11px] font-black uppercase tracking-widest border-2 border-white bg-transparent text-white px-4 py-2 text-center hover:bg-white hover:text-black transition-colors leading-none brutal-btn";

const PARAM_FIELD_CHROME =
  "border-2 border-black dark:border-white bg-white dark:bg-panel font-mono brutal-btn text-black dark:text-white";

/** Modal / full-width text fields */
export const PARAM_INPUT_TEXT_CLASS = `param-input w-full ${PARAM_FIELD_CHROME} font-bold`;

export const PARAM_TEXTAREA_CLASS = `preset-textarea param-input w-full ${PARAM_FIELD_CHROME} font-bold`;

/** Inline select next to help */
export const PARAM_SELECT_FLEX_CLASS = `param-input flex-1 min-w-0 ${PARAM_FIELD_CHROME} cursor-pointer appearance-none`;

/** Preset dropdown in controls header */
export const PARAM_PRESET_CHOOSER_CLASS = `param-input w-full min-w-0 ${PARAM_FIELD_CHROME} cursor-pointer appearance-none text-[10px] font-black uppercase tracking-[0.06em]`;

/** Header file picker */
export const PARAM_FILE_INPUT_CLASS = `param-file w-full ${PARAM_FIELD_CHROME} cursor-pointer`;

/** RNG seed number */
export const PARAM_INPUT_NUMBER_CLASS = `param-input flex-1 min-w-0 ${PARAM_FIELD_CHROME} font-bold tabular-nums text-right`;

const ACCENT_EXPORT_BASE =
  "flex-1 min-w-0 font-mono text-[10px] font-black uppercase border-2 border-black dark:border-white text-black py-1.5 hover:bg-white transition-colors cursor-pointer leading-tight brutal-btn text-center";

export const ACCENT_EXPORT_LIVE_CLASS = `${ACCENT_EXPORT_BASE} tracking-[0.08em] bg-[#2eff46] px-0.5 lg:py-1`;

export const ACCENT_EXPORT_RENDER_CLASS = `${ACCENT_EXPORT_BASE} tracking-[0.08em] bg-[#00e5ff] px-0.5 lg:py-1`;

export const ACCENT_PICKER_WEBM_CLASS = `${ACCENT_EXPORT_BASE} tracking-[0.1em] bg-[#2eff46] py-1.5 px-1`;

export const ACCENT_PICKER_MP4_CLASS = `${ACCENT_EXPORT_BASE} tracking-[0.1em] bg-[#00e5ff] py-1.5 px-1`;
