import { DEFAULT_SIDEBAR_PRESET_VALUES } from "../presets/sidebarPresets";
import { SCALE_STEPS } from "../runtime/constants";

export const engineState = {
  quality: 10,
  scaleIndex: DEFAULT_SIDEBAR_PRESET_VALUES.scaleIndex,
  get scale() {
    return SCALE_STEPS[this.scaleIndex];
  },
  chromaMode: 2,
  glitch: 0,
  mosh: 0,
  datamosh: 0,
  corrupt: 0,
  ringing: 1.0,
  colorDrift: 0,
  seed: -1,
  moshResetRequested: false,
  chromaBleed: 0,
  bitCrush: 0,
  blockEcho: 0,
  dcStep: 0,
  phaseShift: 0,
  echoBeforeJpeg: 0,
};
