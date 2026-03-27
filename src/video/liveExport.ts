import { downloadBlob } from "../lib/downloadBlob";
import {
  configureVideoEncoderForMp4,
  createMp4Muxer,
} from "../media/h264Codec";
import type { LiveExportFormat, LiveExportSession } from "../runtime/types";

export interface LiveExportDeps {
  get outputCanvas(): HTMLCanvasElement;
  getCurrentExportSize: () => { width: number; height: number } | null;
  activeLiveExportFPS: () => number;
  render: () => void;
  get liveExportSession(): LiveExportSession | null;
  setLiveExportSession: (s: LiveExportSession | null) => void;
  get isLiveExportFinalizing(): boolean;
  setIsLiveExportFinalizing: (v: boolean) => void;
  get isLiveExportStarting(): boolean;
  setIsLiveExportStarting: (v: boolean) => void;
  liveExportPicker: HTMLElement;
  liveExportPickerSize: HTMLElement;
  liveExportWebmBtn: HTMLButtonElement;
  liveExportMp4Btn: HTMLButtonElement;
  liveExportCancelBtn: HTMLButtonElement;
  exportBtn: HTMLButtonElement;
}

export function isLiveExportActive(deps: LiveExportDeps): boolean {
  return deps.liveExportSession !== null;
}

function resetExportButtonState(deps: LiveExportDeps): void {
  deps.exportBtn.disabled = false;
  deps.exportBtn.textContent = "LIVE REC";
  deps.exportBtn.style.backgroundColor = "#2eff46";
  deps.exportBtn.style.color = "black";
  deps.liveExportWebmBtn.disabled = false;
  deps.liveExportMp4Btn.disabled = false;
  deps.liveExportCancelBtn.disabled = false;
}

function setLiveExportButtonState(
  deps: LiveExportDeps,
  session: LiveExportSession,
): void {
  deps.exportBtn.disabled = false;
  const formatLabel = session.format.toUpperCase();
  const elapsed = Math.floor((Date.now() - session.recordingStartTime) / 1000);
  const minutes = Math.floor(elapsed / 60);
  const seconds = (elapsed % 60).toString().padStart(2, "0");
  deps.exportBtn.textContent = `${formatLabel} [${minutes}:${seconds}] STOP`;
  deps.exportBtn.style.backgroundColor = "#ff2e46";
  deps.exportBtn.style.color = "white";
}

function setLiveExportFinalizingState(deps: LiveExportDeps): void {
  deps.exportBtn.disabled = true;
  deps.exportBtn.textContent = "FINALIZING…";
  deps.exportBtn.style.backgroundColor = "#ff2e46";
  deps.exportBtn.style.color = "white";
}

function setLiveExportStartingState(deps: LiveExportDeps): void {
  deps.exportBtn.disabled = true;
  deps.exportBtn.textContent = "STARTING…";
  deps.exportBtn.style.backgroundColor = "#2eff46";
  deps.exportBtn.style.color = "black";
  deps.liveExportWebmBtn.disabled = true;
  deps.liveExportMp4Btn.disabled = true;
  deps.liveExportCancelBtn.disabled = true;
}

function scrollLiveExportPickerIntoView(deps: LiveExportDeps): void {
  const scrollPanel = deps.liveExportPicker.closest("section");

  const scrollToEnd = () => {
    void deps.liveExportPicker.offsetHeight;
    if (scrollPanel) {
      const maxTop = Math.max(
        0,
        scrollPanel.scrollHeight - scrollPanel.clientHeight,
      );
      scrollPanel.scrollTop = maxTop;
    }
    deps.liveExportPicker.scrollIntoView({
      block: "end",
      inline: "nearest",
      behavior: "auto",
    });
  };

  scrollToEnd();
  requestAnimationFrame(() => {
    scrollToEnd();
    requestAnimationFrame(scrollToEnd);
  });
  setTimeout(scrollToEnd, 80);
  setTimeout(scrollToEnd, 240);
}

export function openLiveExportModal(deps: LiveExportDeps): void {
  const size = deps.getCurrentExportSize();
  if (!size) {
    alert("Load media first so there is a frame to export.");
    return;
  }

  deps.liveExportPickerSize.textContent = `Locked Size: ${size.width} x ${
    size.height
  } @ ${deps.activeLiveExportFPS()} FPS`;
  deps.liveExportPicker.classList.remove("hidden");
  deps.liveExportPicker.setAttribute("aria-hidden", "false");
  scrollLiveExportPickerIntoView(deps);
}

export function closeLiveExportModal(
  deps: LiveExportDeps,
  force = false,
): void {
  if (!force && deps.isLiveExportStarting) return;
  deps.liveExportPicker.classList.add("hidden");
  deps.liveExportPicker.setAttribute("aria-hidden", "true");
  deps.liveExportWebmBtn.disabled = false;
  deps.liveExportMp4Btn.disabled = false;
  deps.liveExportCancelBtn.disabled = false;
}

function makeLiveExportCanvas(
  width: number,
  height: number,
): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d", { alpha: false });
  if (!ctx) {
    throw new Error("Could not create export canvas.");
  }
  ctx.imageSmoothingEnabled = false;
  ctx.fillStyle = "black";
  ctx.fillRect(0, 0, width, height);
  return { canvas, ctx };
}

async function waitForLiveExportMirrorFrame(
  video: HTMLVideoElement,
): Promise<void> {
  if (video.readyState >= 2 && video.videoWidth > 0 && video.videoHeight > 0) {
    return;
  }

  await new Promise<void>((resolve, reject) => {
    const timeoutId = window.setTimeout(() => {
      cleanup();
      reject(new Error("Could not mirror the live preview for export."));
    }, 1500);
    const onReady = () => {
      if (
        video.readyState < 2 ||
        video.videoWidth <= 0 ||
        video.videoHeight <= 0
      ) {
        return;
      }
      cleanup();
      resolve();
    };
    const onError = () => {
      cleanup();
      reject(new Error("Could not mirror the live preview for export."));
    };
    const cleanup = () => {
      window.clearTimeout(timeoutId);
      video.removeEventListener("loadedmetadata", onReady);
      video.removeEventListener("loadeddata", onReady);
      video.removeEventListener("canplay", onReady);
      video.removeEventListener("error", onError);
    };

    video.addEventListener("loadedmetadata", onReady);
    video.addEventListener("loadeddata", onReady);
    video.addEventListener("canplay", onReady);
    video.addEventListener("error", onError, { once: true });
  });
}

function createLiveExportMirrorVideo(
  outputCanvas: HTMLCanvasElement,
  fps: number,
): { stream: MediaStream; video: HTMLVideoElement } {
  const stream = outputCanvas.captureStream(fps);
  const video = document.createElement("video");
  video.muted = true;
  video.playsInline = true;
  video.autoplay = true;
  video.srcObject = stream;

  void video.play().catch(() => {
    // Muted stream playback can still be blocked in some browsers; frame reads may still work.
  });

  return { stream, video };
}

function drawLiveExportSource(session: LiveExportSession): void {
  if (!session.mirrorVideo || session.mirrorVideo.readyState < 2) return;
  session.exportCtx.drawImage(
    session.mirrorVideo,
    0,
    0,
    session.width,
    session.height,
  );
}

export function captureLiveExportFrame(
  deps: LiveExportDeps,
  session: LiveExportSession,
): void {
  if (deps.liveExportSession !== session) return;
  drawLiveExportSource(session);
  if (session.format === "webm") {
    session.streamTrack?.requestFrame?.();
  }

  if (session.mp4Encoder) {
    const timestamp = Math.round(
      (session.frameCount * 1_000_000) / session.fps,
    );
    const duration = Math.max(1, Math.round(1_000_000 / session.fps));
    const frame = new VideoFrame(session.exportCanvas, { timestamp, duration });
    session.mp4Encoder.encode(frame, {
      keyFrame: session.frameCount % Math.max(session.fps, 1) === 0,
    });
    frame.close();
  }

  session.frameCount += 1;
}

export function cleanupLiveExportSession(session: LiveExportSession): void {
  if (session.frameInterval !== null) {
    clearInterval(session.frameInterval);
    session.frameInterval = null;
  }
  if (session.statusInterval !== null) {
    clearInterval(session.statusInterval);
    session.statusInterval = null;
  }
  if (session.mirrorVideo) {
    session.mirrorVideo.pause();
    session.mirrorVideo.srcObject = null;
  }
  session.mirrorVideo = null;
  session.sourceStream?.getTracks().forEach((track) => track.stop());
  session.sourceStream = null;
  session.stream?.getTracks().forEach((track) => track.stop());
  session.stream = null;
  session.streamTrack = null;
  session.mediaRecorder = null;
  if (session.mp4Encoder && session.mp4Encoder.state !== "closed") {
    session.mp4Encoder.close();
  }
  session.mp4Encoder = null;
  session.mp4Muxer = null;
}

export async function startLiveExport(
  format: LiveExportFormat,
  deps: LiveExportDeps,
): Promise<void> {
  const size = deps.getCurrentExportSize();
  if (!size) {
    alert("Load media first so there is a frame to export.");
    return;
  }

  const fps = deps.activeLiveExportFPS();
  const { canvas, ctx } = makeLiveExportCanvas(size.width, size.height);

  const session: LiveExportSession = {
    format,
    fps,
    width: size.width,
    height: size.height,
    exportCanvas: canvas,
    exportCtx: ctx,
    sourceStream: null,
    mirrorVideo: null,
    stream: null,
    streamTrack: null,
    mediaRecorder: null,
    recordedChunks: [],
    mp4Encoder: null,
    mp4Muxer: null,
    frameInterval: null,
    statusInterval: null,
    recordingStartTime: 0,
    frameCount: 0,
  };

  deps.setIsLiveExportStarting(true);
  setLiveExportStartingState(deps);

  try {
    const liveSource = createLiveExportMirrorVideo(
      deps.outputCanvas,
      session.fps,
    );
    session.sourceStream = liveSource.stream;
    session.mirrorVideo = liveSource.video;
    deps.render();
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => resolve()),
    );
    await waitForLiveExportMirrorFrame(session.mirrorVideo);
    drawLiveExportSource(session);

    if (format === "webm") {
      const stream = canvas.captureStream(session.fps);
      const streamTrack = stream.getVideoTracks()[0] as
        | CanvasCaptureMediaStreamTrack
        | undefined;
      if (!streamTrack) {
        throw new Error("Could not create live export video track.");
      }

      let recorderOptions: MediaRecorderOptions = {
        mimeType: "video/webm; codecs=vp9",
      };
      if (!MediaRecorder.isTypeSupported(recorderOptions.mimeType!)) {
        recorderOptions = { mimeType: "video/webm; codecs=vp8" };
      }
      if (!MediaRecorder.isTypeSupported(recorderOptions.mimeType!)) {
        recorderOptions = { mimeType: "video/webm" };
      }

      session.stream = stream;
      session.streamTrack = streamTrack;
      session.mediaRecorder = new MediaRecorder(stream, recorderOptions);
      session.mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) session.recordedChunks.push(event.data);
      };
      session.mediaRecorder.start(1000);
      session.recordingStartTime = Date.now();
      session.streamTrack.requestFrame?.();
    } else {
      if (typeof VideoEncoder === "undefined") {
        throw new Error(
          "This browser does not support MP4 export via WebCodecs.",
        );
      }

      const encoderConfig: Omit<VideoEncoderConfig, "codec"> = {
        width: session.width,
        height: session.height,
        bitrate: 10_000_000,
        framerate: session.fps,
        latencyMode: "quality",
      };

      const mp4Muxer = await createMp4Muxer({
        fps: session.fps,
        width: session.width,
        height: session.height,
      });
      session.mp4Muxer = mp4Muxer;

      session.mp4Encoder = new VideoEncoder({
        output: (chunk, meta) => mp4Muxer.addVideoChunk(chunk, meta),
        error: (error) => console.error("Live MP4 export failed:", error),
      });
      await configureVideoEncoderForMp4(session.mp4Encoder, encoderConfig);
      session.recordingStartTime = Date.now();
    }

    deps.setLiveExportSession(session);
    closeLiveExportModal(deps, true);
    captureLiveExportFrame(deps, session);
    session.frameInterval = window.setInterval(
      () => captureLiveExportFrame(deps, session),
      Math.max(1, Math.round(1000 / session.fps)),
    );
    session.statusInterval = window.setInterval(
      () => setLiveExportButtonState(deps, session),
      1000,
    );
    setLiveExportButtonState(deps, session);
  } catch (err) {
    cleanupLiveExportSession(session);
    deps.setLiveExportSession(null);
    resetExportButtonState(deps);
    console.error("Live export failed:", err);
    alert(
      (err as Error).message || "Could not start live export in this browser.",
    );
  } finally {
    deps.setIsLiveExportStarting(false);
    if (deps.liveExportPicker.getAttribute("aria-hidden") === "false") {
      deps.liveExportWebmBtn.disabled = false;
      deps.liveExportMp4Btn.disabled = false;
      deps.liveExportCancelBtn.disabled = false;
    }
  }
}

export async function stopLiveExport(deps: LiveExportDeps): Promise<void> {
  const session = deps.liveExportSession;
  if (!session || deps.isLiveExportFinalizing) return;

  deps.setLiveExportSession(null);
  deps.setIsLiveExportFinalizing(true);
  if (session.frameInterval !== null) {
    clearInterval(session.frameInterval);
    session.frameInterval = null;
  }
  if (session.statusInterval !== null) {
    clearInterval(session.statusInterval);
    session.statusInterval = null;
  }
  setLiveExportFinalizingState(deps);

  try {
    if (session.mediaRecorder) {
      const recorder = session.mediaRecorder;
      const rawBlob = await new Promise<Blob>((resolve, reject) => {
        recorder.onstop = () =>
          resolve(
            new Blob(session.recordedChunks, {
              type: recorder.mimeType || "video/webm",
            }),
          );
        recorder.onerror = () =>
          reject(new Error("WebM export failed while finalizing."));
        recorder.requestData();
        recorder.stop();
      });
      const durationMs = Math.max(
        1,
        session.frameCount > 0
          ? Math.round((session.frameCount * 1000) / session.fps)
          : Date.now() - session.recordingStartTime,
      );
      const { default: fixWebmDuration } = await import("fix-webm-duration");
      const fixedBlob = await fixWebmDuration(rawBlob, durationMs, {
        logger: false,
      });
      downloadBlob(fixedBlob, `rtjpeg_export_${Date.now()}.webm`);
    } else if (session.mp4Encoder && session.mp4Muxer) {
      await session.mp4Encoder.flush();
      await session.mp4Muxer.finalize();
      const buffer = session.mp4Muxer.target.buffer;
      if (!buffer) throw new Error("Could not finalize the MP4 export.");
      let outBlob = new Blob([buffer], { type: "video/mp4" });
      try {
        const { transcodeExportMp4ForDevicePlayback } =
          await import("./videoTranscoder");
        outBlob = await transcodeExportMp4ForDevicePlayback(outBlob);
      } catch (err) {
        console.warn(
          "[rtjpeg] MP4 finalize (ffmpeg) failed; saving raw WebCodecs output.",
          err,
        );
      }
      downloadBlob(outBlob, `rtjpeg_export_${Date.now()}.mp4`);
    }
  } catch (err) {
    console.error("Failed to finalize live export:", err);
    alert((err as Error).message || "Could not finalize the live export.");
  } finally {
    cleanupLiveExportSession(session);
    deps.setIsLiveExportFinalizing(false);
    resetExportButtonState(deps);
  }
}
