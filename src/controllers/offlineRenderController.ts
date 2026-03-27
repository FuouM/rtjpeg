import {
  createMp4Muxer,
  configureVideoEncoderForMp4,
} from "../media/h264Codec";
import {
  processOfflineFrame,
  type OfflineRenderDeps,
} from "../video/offlineRender";
import {
  isLiveExportActive,
  stopLiveExport,
  type LiveExportDeps,
} from "../video/liveExport";
import type { AppDom } from "../appShell/queryAppDom";
import {
  saveCurrentImage,
  copyCurrentFrameToClipboard,
  downloadCurrentFrame,
  type StillFrameExportDeps,
} from "../video/stillFrameExport";
import { offlineRenderState } from "../state/offlineRenderState";

export interface OfflineRenderControllerDeps {
  dom: AppDom;
  liveExportDeps: LiveExportDeps;
  stillFrameDeps: StillFrameExportDeps;
  offlineRenderDeps: OfflineRenderDeps;
  isImageSource: () => boolean;
  clearProcessedCache: () => void;
  updateSourceModeUI: () => void;
  getOfflineFps: () => number;
}

export function setupOfflineRenderController(
  deps: OfflineRenderControllerDeps,
) {
  const {
    dom,
    liveExportDeps,
    stillFrameDeps,
    offlineRenderDeps,
    isImageSource,
    clearProcessedCache,
    updateSourceModeUI,
    getOfflineFps,
  } = deps;

  dom.renderBtn.addEventListener("click", async () => {
    if (isImageSource()) {
      saveCurrentImage(stillFrameDeps);
      return;
    }
    if (offlineRenderState.isOfflineRendering) {
      offlineRenderState.isOfflineRendering = false;
      dom.sourceVideo.pause();
      if (
        offlineRenderState.offlineEncoder &&
        offlineRenderState.offlineEncoder.state !== "closed"
      ) {
        try {
          offlineRenderState.offlineEncoder.close();
        } catch {
          /* ignore */
        }
      }
      offlineRenderState.offlineEncoder = null;
      offlineRenderState.offlineMuxer = null;
      dom.renderBtn.disabled = false;
      dom.renderBtn.textContent = "RENDER VIDEO";
      dom.renderBtn.style.backgroundColor = "#00e5ff";
      dom.renderBtn.style.color = "black";
      return;
    }

    if (
      liveExportDeps.isLiveExportFinalizing ||
      liveExportDeps.isLiveExportStarting
    ) {
      return;
    }
    if (isLiveExportActive(liveExportDeps)) {
      await stopLiveExport(liveExportDeps);
    }

    offlineRenderState.isOfflineRendering = true;
    offlineRenderState.offlineFrameCount = 0;
    dom.sourceVideo.pause();
    clearProcessedCache();

    dom.renderBtn.disabled = true;
    dom.renderBtn.textContent = "⚙️ Preparing…";
    dom.renderBtn.style.backgroundColor = "#ff2e46";
    dom.renderBtn.style.color = "white";

    try {
      const muxer = await createMp4Muxer({
        width: dom.outputCanvas.width,
        height: dom.outputCanvas.height,
      });
      offlineRenderState.offlineMuxer = muxer;
      if (!offlineRenderState.isOfflineRendering) {
        offlineRenderState.offlineMuxer = null;
        return;
      }

      offlineRenderState.offlineEncoder = new VideoEncoder({
        output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
        error: (e) => console.error(e),
      });

      const offlineEncoderBase: Omit<VideoEncoderConfig, "codec"> = {
        width: dom.outputCanvas.width,
        height: dom.outputCanvas.height,
        bitrate: 10_000_000,
        framerate: getOfflineFps(),
        latencyMode: "quality",
      };
      await configureVideoEncoderForMp4(
        offlineRenderState.offlineEncoder,
        offlineEncoderBase,
      );
      if (!offlineRenderState.isOfflineRendering) {
        if (offlineRenderState.offlineEncoder.state !== "closed") {
          try {
            offlineRenderState.offlineEncoder.close();
          } catch {
            /* ignore */
          }
        }
        offlineRenderState.offlineEncoder = null;
        offlineRenderState.offlineMuxer = null;
        return;
      }

      dom.renderBtn.disabled = false;
      dom.renderBtn.textContent = "⚙️ 0%";
      dom.renderBtn.style.backgroundColor = "#ff2e46";
      dom.renderBtn.style.color = "white";

      void processOfflineFrame(offlineRenderDeps);
    } catch (e) {
      console.error("Offline render failed to start:", e);
      offlineRenderState.isOfflineRendering = false;
      if (
        offlineRenderState.offlineEncoder &&
        offlineRenderState.offlineEncoder.state !== "closed"
      ) {
        try {
          offlineRenderState.offlineEncoder.close();
        } catch {
          /* ignore */
        }
      }
      offlineRenderState.offlineEncoder = null;
      offlineRenderState.offlineMuxer = null;
      dom.renderBtn.disabled = false;
      dom.renderBtn.style.backgroundColor = "#00e5ff";
      dom.renderBtn.style.color = "black";
      updateSourceModeUI();
      alert((e as Error).message || "Could not start video render.");
    }
  });

  dom.copyFrameBtn.addEventListener("click", () => {
    copyCurrentFrameToClipboard(stillFrameDeps);
  });
  dom.downloadFrameBtn.addEventListener("click", () => {
    downloadCurrentFrame(stillFrameDeps);
  });
}
