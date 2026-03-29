import { GpuContext } from "../gpu/gpuContext";
import { showWebGPUUnsupportedBanner } from "../ui/webgpuBanner";
import {
  computeFrameSeed,
  packParamsFloats,
  PARAM_FLOAT_COUNT,
} from "../renderer/paramUniforms";
import { engineState } from "../state/engineState";
import { renderLoopMutable } from "../renderer/renderLoop";
import { flowState } from "../state/flowState";
import { videoMetadataState } from "../state/videoMetadataState";
import { seekScrubState } from "../timeline/seekScrub";

import { packHuffmanLuts } from "../renderer/huffmanTables";

export interface GpuControllerDeps {
  outputCanvas: HTMLCanvasElement;
  updateCacheCanvas: () => void;
  activeSourceTimeSec: () => number;
  activeSourceWidth: () => number;
  activeSourceHeight: () => number;
}

export function setupGpuController(deps: GpuControllerDeps) {
  const {
    outputCanvas,
    updateCacheCanvas,
    activeSourceTimeSec,
    activeSourceWidth,
    activeSourceHeight,
  } = deps;

  let gpu: GpuContext | null = null;
  let gpuInitPromise: Promise<boolean> | null = null;
  const paramsData = new Float32Array(PARAM_FLOAT_COUNT);

  async function ensureGpuReady(): Promise<boolean> {
    if (gpu) return true;
    if (gpuInitPromise) return gpuInitPromise;
    gpuInitPromise = (async () => {
      try {
        gpu = await GpuContext.create(outputCanvas);
        updateCacheCanvas();
        return true;
      } catch (error) {
        const msg =
          error instanceof Error
            ? error.message
            : "An error occurred during WebGPU initialization.";
        showWebGPUUnsupportedBanner(msg);
        console.error(error);
        return false;
      } finally {
        if (!gpu) gpuInitPromise = null;
      }
    })();
    return gpuInitPromise;
  }

  function writeParamsBuffer() {
    if (!gpu) return;
    const frameSeed = computeFrameSeed({
      seedMode: engineState.seed,
      globalFrameCount: renderLoopMutable.globalFrameCount,
      activeSourceTimeSec: activeSourceTimeSec(),
      offlineFps: videoMetadataState.OFFLINE_FPS,
    });
    packParamsFloats(paramsData, {
      quality: engineState.quality,
      outputWidth: outputCanvas.width,
      outputHeight: outputCanvas.height,
      activeSourceWidth: activeSourceWidth(),
      activeSourceHeight: activeSourceHeight(),
      chromaMode: engineState.chromaMode,
      glitchPct: engineState.glitch,
      ringing: engineState.ringing,
      colorDrift: engineState.colorDrift,
      frameSeed,
      moshPct: engineState.mosh,
      corruptPct: engineState.corrupt,
      datamoshPct: engineState.datamosh,
      dcStepPct: engineState.dcStep,
      phaseShiftPct: engineState.phaseShift,
      moshReset: engineState.moshResetRequested ? 1.0 : 0.0,
      chromaBleedPct: engineState.chromaBleed,
      bitCrushPct: engineState.bitCrush,
      suppressTemporalHistory:
        seekScrubState.suppressTemporalHistoryRenders > 0,
      blockEchoPct: engineState.blockEcho,
      echoBeforeJpeg: engineState.echoBeforeJpeg,
      customFlowX: flowState.customFlowX,
      customFlowY: flowState.customFlowY,
      useCustomFlow: flowState.useCustomFlow,
      invertDct: engineState.invertDct,
      lockChroma: engineState.lockChroma,
      huffmanDesyncPct: engineState.huffmanDesync,
      huffmanShiftPct: engineState.huffmanShift,
      huffmanCorruptPct: engineState.huffmanCorrupt,
    });
    gpu.device.queue.writeBuffer(gpu.paramsBuffer, 0, paramsData);
    engineState.moshResetRequested = false;

    if (
      (engineState.huffmanDesync > 0 || engineState.huffmanCorrupt > 0 || engineState.huffmanShift > 0) &&
      gpu.huffmanLuts
    ) {
      const data = packHuffmanLuts();
      gpu.device.queue.writeBuffer(
        gpu.huffmanLuts,
        0,
        data.buffer,
        0,
        data.byteLength,
      );
    }
  }

  return {
    getGpuContext: () => gpu,
    ensureGpuReady,
    writeParamsBuffer,
  };
}
