import { PRESET_CHOOSER_DEFAULTS } from "../runtime/constants";
import type { SidebarPresetRecord } from "../presets/sidebarPresets";

export const presetState = {
  savedSidebarPresets: [] as SidebarPresetRecord[],
  presetChooserSelection: PRESET_CHOOSER_DEFAULTS,
  presetQrSyncToken: 0,
};
