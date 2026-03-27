import { downloadBlob } from "../lib/downloadBlob";

export interface StillFrameExportDeps {
  get outputCanvas(): HTMLCanvasElement;
  copyFrameBtn: HTMLButtonElement;
  downloadFrameBtn: HTMLButtonElement;
  render: () => void;
}

const COPY_FRAME_BTN_DEFAULT = "COPY FRAME";
const DOWNLOAD_FRAME_BTN_DEFAULT = "DOWNLOAD FRAME";
const FRAME_ACTION_FEEDBACK_MS = 1600;

const copyFrameFlashTimer = {
  id: null as ReturnType<typeof setTimeout> | null,
};
const downloadFrameFlashTimer = {
  id: null as ReturnType<typeof setTimeout> | null,
};

function flashFrameActionSuccess(
  btn: HTMLButtonElement,
  momentaryLabel: string,
  defaultLabel: string,
  timerRef: { id: ReturnType<typeof setTimeout> | null },
): void {
  if (timerRef.id) {
    clearTimeout(timerRef.id);
    timerRef.id = null;
  }
  btn.textContent = momentaryLabel;
  btn.classList.add("frame-action-flash-success");
  timerRef.id = setTimeout(() => {
    btn.textContent = defaultLabel;
    btn.classList.remove("frame-action-flash-success");
    timerRef.id = null;
  }, FRAME_ACTION_FEEDBACK_MS);
}

export function saveCurrentImage(deps: StillFrameExportDeps): void {
  deps.render();
  deps.outputCanvas.toBlob((blob) => {
    if (!blob) {
      alert("Could not save image.");
      return;
    }
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.style.display = "none";
    a.href = url;
    a.download = `rtjpeg_image_${Date.now()}.png`;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }, 100);
  }, "image/png");
}

export function copyCurrentFrameToClipboard(deps: StillFrameExportDeps): void {
  deps.render();
  deps.copyFrameBtn.disabled = true;
  deps.copyFrameBtn.textContent = "COPYING…";
  deps.outputCanvas.toBlob(async (blob) => {
    try {
      if (!blob) {
        alert("Could not copy frame.");
        return;
      }
      if (typeof ClipboardItem === "undefined" || !navigator.clipboard?.write) {
        alert("Clipboard image copy is not supported in this browser.");
        return;
      }
      await navigator.clipboard.write([
        new ClipboardItem({ "image/png": blob }),
      ]);
      flashFrameActionSuccess(
        deps.copyFrameBtn,
        "COPIED!",
        COPY_FRAME_BTN_DEFAULT,
        copyFrameFlashTimer,
      );
    } catch (error) {
      console.error("Copy frame failed:", error);
      alert("Could not copy frame to clipboard.");
    } finally {
      deps.copyFrameBtn.disabled = false;
      if (copyFrameFlashTimer.id === null) {
        deps.copyFrameBtn.textContent = COPY_FRAME_BTN_DEFAULT;
      }
    }
  }, "image/png");
}

export function downloadCurrentFrame(deps: StillFrameExportDeps): void {
  deps.render();
  deps.downloadFrameBtn.disabled = true;
  deps.downloadFrameBtn.textContent = "PREPARING…";
  deps.outputCanvas.toBlob((blob) => {
    try {
      if (!blob) {
        alert("Could not export frame.");
        return;
      }
      downloadBlob(blob, `rtjpeg_frame_${Date.now()}.png`);
      flashFrameActionSuccess(
        deps.downloadFrameBtn,
        "DOWNLOADED!",
        DOWNLOAD_FRAME_BTN_DEFAULT,
        downloadFrameFlashTimer,
      );
    } finally {
      deps.downloadFrameBtn.disabled = false;
      if (downloadFrameFlashTimer.id === null) {
        deps.downloadFrameBtn.textContent = DOWNLOAD_FRAME_BTN_DEFAULT;
      }
    }
  }, "image/png");
}
