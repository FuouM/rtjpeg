import type { Mp4VideoMuxer } from "../media/h264Codec";

export const offlineRenderState = {
  isOfflineRendering: false,
  offlineFrameCount: 0,

  /** PTS (seconds) for the frame being encoded — drives timeline playhead so it matches stripe positions. */
  offlineRenderHeadTimeForUi: 0,

  offlineEncoder: null as VideoEncoder | null,
  offlineMuxer: null as Mp4VideoMuxer | null,
};
