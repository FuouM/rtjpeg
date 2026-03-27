import type { LiveExportSession } from "../runtime/types";

export const liveExportState = {
  liveExportSession: null as LiveExportSession | null,
  isLiveExportFinalizing: false,
  /** True while WebM/MP4 live export is setting up (mirror stream, muxer, encoder). */
  isLiveExportStarting: false,
};
