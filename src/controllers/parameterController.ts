import type { AppDom } from "../appShell/queryAppDom";
import {
  DEFAULT_SIDEBAR_PRESET_VALUES,
  normalizeSeedValue,
  type SidebarPresetValues,
} from "../presets/sidebarPresets";
import { SCALE_STEPS } from "../runtime/constants";
import { engineState } from "../state/engineState";

export interface ParameterControllerOptions {
  dom: AppDom;
  onParamsChanged: (clearCache?: boolean) => void;
  clearProcessedCache: () => void;
}

export function setupParameterController({
  dom,
  onParamsChanged,
  clearProcessedCache,
}: ParameterControllerOptions) {
  function getCurrentSidebarPresetValues(): SidebarPresetValues {
    return {
      quality: engineState.quality,
      scaleIndex: engineState.scaleIndex,
      chromaMode: engineState.chromaMode,
      glitch: engineState.glitch,
      mosh: engineState.mosh,
      datamosh: engineState.datamosh,
      corrupt: engineState.corrupt,
      ringing: engineState.ringing,
      colorDrift: engineState.colorDrift === 1,
      chromaBleed: engineState.chromaBleed,
      bitCrush: engineState.bitCrush,
      blockEcho: engineState.blockEcho,
      echoBeforeJpeg: engineState.echoBeforeJpeg === 1,
      dcStep: engineState.dcStep,
      phaseShift: engineState.phaseShift,
      seed: engineState.seed,
      invertDct: engineState.invertDct === 1,
      lockChroma: engineState.lockChroma,
      huffmanDesync: engineState.huffmanDesync,
      huffmanShift: engineState.huffmanShift,
      huffmanCorrupt: engineState.huffmanCorrupt,
    };
  }

  function drawPhaseShiftPreview() {
    const ctx = dom.phaseShiftCtx;
    const canvas = dom.phaseShiftCanvas;
    // ensure clear render resolution
    const rect = canvas.getBoundingClientRect();
    if (canvas.width !== rect.width || canvas.height !== rect.height) {
      canvas.width = rect.width;
      canvas.height = rect.height;
    }

    const width = canvas.width;
    const height = canvas.height;
    
    ctx.clearRect(0, 0, width, height);
    
    const phaseShift = engineState.phaseShift;
    const isDark = document.documentElement.classList.contains("dark");
    const pct = phaseShift / 100.0;
    const manualPhase = pct * 12.56637; // 4PI

    // Unshifted base sine wave (reference)
    ctx.strokeStyle = isDark ? "rgba(255, 255, 255, 0.25)" : "rgba(0, 0, 0, 0.25)";
    ctx.lineWidth = 1;
    ctx.setLineDash([2, 4]);
    ctx.beginPath();
    for (let idx = 0; idx <= 63; idx++) {
      const baseWave = Math.sin(idx * 0.4); 
      const baseX = (idx / 63) * width;
      const baseY = (height / 2) - (baseWave * (height / 2) * 0.8);
      if (idx === 0) ctx.moveTo(baseX, baseY);
      else ctx.lineTo(baseX, baseY);
    }
    ctx.stroke();
    ctx.setLineDash([]);
    
    // Shifted and amplitude-modulated wave
    ctx.strokeStyle = "#10B981"; // Emerald green
    ctx.lineWidth = 2;
    ctx.beginPath();
    
    for (let idx = 0; idx <= 63; idx++) {
      const wave = Math.sin(idx * 0.4 + manualPhase);
      const ampMod = wave * pct; 
      
      const x = (idx / 63) * width;
      const y = (height / 2) - (ampMod * (height / 2) * 0.8);
      
      if (idx === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }

  // Draw once after a tiny delay so layout sizes canvas properly
  requestAnimationFrame(drawPhaseShiftPreview);

  function setScaleIndex(index: number): void {
    const clamped = Math.min(Math.max(index, 0), SCALE_STEPS.length - 1);
    engineState.scaleIndex = clamped;
    dom.scaleSlider.value = String(clamped);
    dom.scaleVal.textContent = String(engineState.scale);
  }

  function applySidebarPresetValues(values: SidebarPresetValues): void {
    engineState.quality = values.quality;
    dom.qualitySlider.value = String(values.quality);
    dom.qualityVal.textContent = String(values.quality);

    setScaleIndex(values.scaleIndex);

    engineState.chromaMode = values.chromaMode;
    dom.chromaSelect.value = String(values.chromaMode);

    engineState.glitch = values.glitch;
    dom.glitchSlider.value = String(values.glitch);
    dom.glitchVal.textContent = String(values.glitch);

    engineState.mosh = values.mosh;
    dom.moshSlider.value = String(values.mosh);
    dom.moshVal.textContent = String(values.mosh);

    engineState.datamosh = values.datamosh;
    dom.datamoshSlider.value = String(values.datamosh);
    dom.datamoshVal.textContent = String(values.datamosh);

    engineState.corrupt = values.corrupt;
    dom.corruptSlider.value = String(values.corrupt);
    dom.corruptVal.textContent = String(values.corrupt);

    engineState.ringing = values.ringing;
    dom.ringingSlider.value = String(values.ringing);
    dom.ringingVal.textContent = values.ringing.toFixed(1);

    engineState.colorDrift = values.colorDrift ? 1 : 0;
    dom.driftToggle.checked = values.colorDrift;

    engineState.chromaBleed = values.chromaBleed;
    dom.chromaBleedSlider.value = String(values.chromaBleed);
    dom.chromaBleedVal.textContent = String(values.chromaBleed);

    engineState.bitCrush = values.bitCrush;
    dom.bitCrushSlider.value = String(values.bitCrush);
    dom.bitCrushVal.textContent = String(values.bitCrush);

    engineState.blockEcho = values.blockEcho;
    dom.echoSlider.value = String(values.blockEcho);
    dom.echoVal.textContent = String(values.blockEcho);

    engineState.dcStep = values.dcStep;
    dom.dcStepSlider.value = String(values.dcStep);
    dom.dcStepVal.textContent = String(values.dcStep);

    engineState.phaseShift = values.phaseShift;
    dom.phaseShiftSlider.value = String(values.phaseShift);
    dom.phaseShiftVal.textContent = String(values.phaseShift);
    drawPhaseShiftPreview();

    engineState.invertDct = values.invertDct ? 1 : 0;
    dom.invertDctToggle.checked = values.invertDct;

    engineState.lockChroma = values.lockChroma;
    dom.lockChromaSlider.value = String(values.lockChroma);
    dom.lockChromaVal.textContent = String(values.lockChroma);

    engineState.seed = normalizeSeedValue(values.seed);
    dom.seedInput.value = String(engineState.seed);

    engineState.huffmanDesync = values.huffmanDesync;
    dom.huffmanDesyncSlider.value = String(values.huffmanDesync);
    dom.huffmanDesyncVal.textContent = String(values.huffmanDesync);

    engineState.huffmanShift = values.huffmanShift;
    dom.huffmanShiftSlider.value = String(values.huffmanShift);
    dom.huffmanShiftVal.textContent = String(values.huffmanShift);

    engineState.huffmanCorrupt = values.huffmanCorrupt;
    dom.huffmanCorruptSlider.value = String(values.huffmanCorrupt);
    dom.huffmanCorruptVal.textContent = String(values.huffmanCorrupt);

    clearProcessedCache();
  }

  function resetSliderToDefault(
    key: keyof SidebarPresetValues,
    clearCache: boolean,
  ): void {
    applySidebarPresetValues({
      ...getCurrentSidebarPresetValues(),
      [key]: DEFAULT_SIDEBAR_PRESET_VALUES[key],
    });
    onParamsChanged(clearCache);
  }

  // --- Event Listeners ---
  dom.qualitySlider.addEventListener("input", (e) => {
    engineState.quality = parseInt((e.target as HTMLInputElement).value, 10);
    dom.qualityVal.textContent = engineState.quality.toString();
    onParamsChanged();
  });

  dom.chromaSelect.addEventListener("change", (e) => {
    engineState.chromaMode = parseInt(
      (e.target as HTMLSelectElement).value,
      10,
    );
    onParamsChanged();
  });

  dom.glitchSlider.addEventListener("input", (e) => {
    engineState.glitch = parseInt((e.target as HTMLInputElement).value, 10);
    dom.glitchVal.textContent = engineState.glitch.toString();
    onParamsChanged();
  });

  dom.moshSlider.addEventListener("input", (e) => {
    engineState.mosh = parseInt((e.target as HTMLInputElement).value, 10);
    dom.moshVal.textContent = engineState.mosh.toString();
    onParamsChanged();
  });

  dom.datamoshSlider.addEventListener("input", (e) => {
    engineState.datamosh = parseInt((e.target as HTMLInputElement).value, 10);
    dom.datamoshVal.textContent = engineState.datamosh.toString();
    onParamsChanged();
  });

  dom.corruptSlider.addEventListener("input", (e) => {
    engineState.corrupt = parseInt((e.target as HTMLInputElement).value, 10);
    dom.corruptVal.textContent = engineState.corrupt.toString();
    onParamsChanged();
  });

  dom.ringingSlider.addEventListener("input", (e) => {
    engineState.ringing = parseFloat((e.target as HTMLInputElement).value);
    dom.ringingVal.textContent = engineState.ringing.toFixed(1);
    onParamsChanged();
  });

  dom.driftToggle.addEventListener("change", (e) => {
    engineState.colorDrift = (e.target as HTMLInputElement).checked ? 1 : 0;
    onParamsChanged();
  });

  dom.chromaBleedSlider.addEventListener("input", (e) => {
    engineState.chromaBleed = parseInt(
      (e.target as HTMLInputElement).value,
      10,
    );
    dom.chromaBleedVal.textContent = engineState.chromaBleed.toString();
    onParamsChanged(true);
  });

  dom.bitCrushSlider.addEventListener("input", (e) => {
    engineState.bitCrush = parseInt((e.target as HTMLInputElement).value, 10);
    dom.bitCrushVal.textContent = engineState.bitCrush.toString();
    onParamsChanged(true);
  });

  dom.echoSlider.addEventListener("input", (e) => {
    engineState.blockEcho = parseInt((e.target as HTMLInputElement).value, 10);
    dom.echoVal.textContent = engineState.blockEcho.toString();
    onParamsChanged(true);
  });

  dom.dcStepSlider.addEventListener("input", (e) => {
    engineState.dcStep = parseInt((e.target as HTMLInputElement).value, 10);
    dom.dcStepVal.textContent = engineState.dcStep.toString();
    onParamsChanged(true);
  });

  dom.phaseShiftSlider.addEventListener("input", (e) => {
    engineState.phaseShift = parseInt((e.target as HTMLInputElement).value, 10);
    dom.phaseShiftVal.textContent = engineState.phaseShift.toString();
    drawPhaseShiftPreview();
    onParamsChanged(true);
  });

  dom.echoBeforeToggle.addEventListener("change", (e) => {
    engineState.echoBeforeJpeg = (e.target as HTMLInputElement).checked ? 1 : 0;
    onParamsChanged(true);
  });

  dom.invertDctToggle.addEventListener("change", (e) => {
    engineState.invertDct = (e.target as HTMLInputElement).checked ? 1 : 0;
    onParamsChanged(true);
  });

  dom.lockChromaSlider.addEventListener("input", (e) => {
    engineState.lockChroma = parseInt((e.target as HTMLInputElement).value, 10);
    dom.lockChromaVal.textContent = engineState.lockChroma.toString();
    onParamsChanged(true);
  });

  dom.huffmanDesyncSlider.addEventListener("input", (e) => {
    engineState.huffmanDesync = parseInt(
      (e.target as HTMLInputElement).value,
      10,
    );
    dom.huffmanDesyncVal.textContent = engineState.huffmanDesync.toString();
    onParamsChanged(true);
  });

  dom.huffmanShiftSlider.addEventListener("input", (e) => {
    engineState.huffmanShift = parseInt(
      (e.target as HTMLInputElement).value,
      10,
    );
    dom.huffmanShiftVal.textContent = engineState.huffmanShift.toString();
    onParamsChanged(true);
  });

  dom.huffmanCorruptSlider.addEventListener("input", (e) => {
    engineState.huffmanCorrupt = parseInt(
      (e.target as HTMLInputElement).value,
      10,
    );
    dom.huffmanCorruptVal.textContent = engineState.huffmanCorrupt.toString();
    onParamsChanged(true);
  });

  dom.seedInput.addEventListener("input", (e) => {
    const el = e.target as HTMLInputElement;
    const raw = el.value;
    const t = raw.trim();
    if (t === "" || t === "-") {
      engineState.seed = -1;
      onParamsChanged();
      return;
    }
    const parsed = parseInt(raw, 10);
    const next = normalizeSeedValue(Number.isNaN(parsed) ? -1 : parsed);
    engineState.seed = next;
    if (parsed < -1 || parsed !== next) el.value = String(next);
    onParamsChanged();
  });

  dom.scaleSlider.addEventListener("input", () => {
    setScaleIndex(parseInt(dom.scaleSlider.value, 10));
    onParamsChanged();
  });

  const sliderDoubleClickDefaults: Array<{
    el: HTMLInputElement;
    key: keyof SidebarPresetValues;
    clearCache: boolean;
  }> = [
    { el: dom.qualitySlider, key: "quality", clearCache: false },
    { el: dom.scaleSlider, key: "scaleIndex", clearCache: false },
    { el: dom.glitchSlider, key: "glitch", clearCache: false },
    { el: dom.moshSlider, key: "mosh", clearCache: false },
    { el: dom.datamoshSlider, key: "datamosh", clearCache: false },
    { el: dom.corruptSlider, key: "corrupt", clearCache: false },
    { el: dom.ringingSlider, key: "ringing", clearCache: false },
    { el: dom.chromaBleedSlider, key: "chromaBleed", clearCache: true },
    { el: dom.echoSlider, key: "blockEcho", clearCache: true },
    { el: dom.dcStepSlider, key: "dcStep", clearCache: true },
    { el: dom.phaseShiftSlider, key: "phaseShift", clearCache: true },
    { el: dom.lockChromaSlider, key: "lockChroma", clearCache: true },
    { el: dom.huffmanDesyncSlider, key: "huffmanDesync", clearCache: true },
    { el: dom.huffmanShiftSlider, key: "huffmanShift", clearCache: true },
    { el: dom.huffmanCorruptSlider, key: "huffmanCorrupt", clearCache: true },
  ];

  for (const { el, key, clearCache } of sliderDoubleClickDefaults) {
    el.addEventListener("dblclick", (e) => {
      e.preventDefault();
      resetSliderToDefault(key, clearCache);
    });
  }

  setScaleIndex(engineState.scaleIndex);

  dom.refreshMoshBtn.addEventListener("click", () => {
    engineState.moshResetRequested = true;
    // We expect the parent (main.ts) to explicitly render when this triggers.
    // However, the refresh mosh button normally calls `render()` right away.
    // For separation of concerns, the caller can just handle dom.refreshMoshBtn
    // if needed, or we fire onParamsChanged() which might trigger render.
  });

  return {
    getCurrentSidebarPresetValues,
    applySidebarPresetValues,
    setScaleIndex,
  };
}
