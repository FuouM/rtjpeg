import {
  closeLiveExportModal,
  isLiveExportActive,
  openLiveExportModal,
  startLiveExport,
  stopLiveExport,
  type LiveExportDeps,
} from "../video/liveExport";
import { type AppDom } from "../appShell/queryAppDom";

export interface ExportControllerDeps {
  dom: AppDom;
  liveExportDeps: LiveExportDeps;
  isOfflineRendering: () => boolean;
}

export function initializeExportController(deps: ExportControllerDeps) {
  const { dom, liveExportDeps, isOfflineRendering } = deps;

  dom.exportBtn.addEventListener("click", async () => {
    if (liveExportDeps.isLiveExportStarting) return;
    if (liveExportDeps.isLiveExportFinalizing) return;
    if (isLiveExportActive(liveExportDeps)) {
      await stopLiveExport(liveExportDeps);
      return;
    }
    if (isOfflineRendering()) return;
    openLiveExportModal(liveExportDeps);
  });

  dom.liveExportCancelBtn.addEventListener("click", () =>
    closeLiveExportModal(liveExportDeps),
  );

  dom.liveExportWebmBtn.addEventListener("click", () => {
    void startLiveExport("webm", liveExportDeps);
  });

  dom.liveExportMp4Btn.addEventListener("click", () => {
    void startLiveExport("mp4", liveExportDeps);
  });

  window.addEventListener("keydown", (event) => {
    if (
      event.key === "Escape" &&
      dom.liveExportPicker.getAttribute("aria-hidden") === "false"
    ) {
      closeLiveExportModal(liveExportDeps);
    }
  });
}
