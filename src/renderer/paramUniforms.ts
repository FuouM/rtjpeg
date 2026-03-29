/**
 * CPU packing for `@group(0) @binding(2) var<uniform> params: Params` in `jpeg_compute.wgsl`.
 * Layout mirrors WGSL comments (7×vec4 = 28 floats).
 */
export const PARAM_FLOAT_COUNT = 32;

/** Slider / UI values before normalization (matches `main` sidebar state). */
export interface ParamUniformPackInput {
  quality: number;
  outputWidth: number;
  outputHeight: number;
  activeSourceWidth: number;
  activeSourceHeight: number;
  chromaMode: number;
  /** 0–100, stored in uniform as /100 */
  glitchPct: number;
  ringing: number;
  colorDrift: number;
  frameSeed: number;
  moshPct: number;
  corruptPct: number;
  datamoshPct: number;
  dcStepPct: number;
  phaseShiftPct: number;
  /** 0 or 1 */
  moshReset: number;
  chromaBleedPct: number;
  bitCrushPct: number;
  suppressTemporalHistory: boolean;
  blockEchoPct: number;
  echoBeforeJpeg: number;
  customFlowX: number;
  customFlowY: number;
  useCustomFlow: boolean;
  invertDct: number; // 0 or 1
  lockChroma: number; // 0 or 1
  huffmanDesyncPct: number;
  huffmanShiftPct: number;
  huffmanCorruptPct: number;
}

export interface FrameSeedInput {
  /** Sidebar seed; `-1` uses `globalFrameCount` for live variation. */
  seedMode: number;
  globalFrameCount: number;
  activeSourceTimeSec: number;
  offlineFps: number;
}

export function computeFrameSeed(i: FrameSeedInput): number {
  if (i.seedMode === -1) return i.globalFrameCount;
  return i.seedMode + Math.floor(i.activeSourceTimeSec * i.offlineFps);
}

/**
 * Writes 24 floats: row0–row5 column-major flatten of `Params` in WGSL.
 * Index 13 is reserved (unused in shader path; kept zero).
 */
export function packParamsFloats(
  out: Float32Array,
  p: ParamUniformPackInput,
): void {
  out[0] = p.quality;
  out[1] = p.outputWidth;
  out[2] = p.outputHeight;
  out[3] = p.activeSourceWidth;
  out[4] = p.activeSourceHeight;
  out[5] = p.chromaMode;
  out[6] = p.glitchPct / 100.0;
  out[7] = p.ringing;
  out[8] = p.colorDrift;
  out[9] = p.frameSeed;
  out[10] = p.moshPct / 100.0;
  out[11] = p.corruptPct / 100.0;
  out[12] = p.datamoshPct / 100.0;
  out[13] = p.phaseShiftPct / 100.0;
  out[14] = p.dcStepPct / 100.0;
  out[15] = p.moshReset;
  out[16] = p.chromaBleedPct / 100.0;
  out[17] = p.bitCrushPct / 100.0;
  out[18] = p.suppressTemporalHistory ? 1.0 : 0.0;
  out[19] = p.blockEchoPct / 100.0;
  out[20] = p.echoBeforeJpeg;
  out[21] = p.customFlowX;
  out[22] = p.customFlowY;
  out[23] = p.useCustomFlow ? 1.0 : 0.0;
  out[24] = p.invertDct;
  out[25] = p.lockChroma / 100.0;
  out[26] = p.huffmanDesyncPct / 100.0;
  out[27] = p.huffmanCorruptPct / 100.0;
  out[28] = p.huffmanShiftPct / 100.0;
}

/** Knobs that affect processed-cache validity (must stay in sync with pack + presets). */
export interface ParamsFingerprintKnobs {
  quality: number;
  scale: number;
  chromaMode: number;
  glitch: number;
  mosh: number;
  corrupt: number;
  datamosh: number;
  ringing: number;
  colorDrift: number;
  chromaBleed: number;
  bitCrush: number;
  blockEcho: number;
  echoBeforeJpeg: number;
  dcStep: number;
  phaseShift: number;
  invertDct: number;
  lockChroma: number;
  huffmanDesync: number;
  huffmanShift: number;
  huffmanCorrupt: number;
}

function hashNumber(hash: number, value: number): number {
  return Math.imul(hash ^ Math.round(value * 1000), 16777619) >>> 0;
}

export function paramsFingerprint(k: ParamsFingerprintKnobs): number {
  let hash = 2166136261;
  hash = hashNumber(hash, k.quality);
  hash = hashNumber(hash, k.scale);
  hash = hashNumber(hash, k.chromaMode);
  hash = hashNumber(hash, k.glitch);
  hash = hashNumber(hash, k.mosh);
  hash = hashNumber(hash, k.corrupt);
  hash = hashNumber(hash, k.datamosh);
  hash = hashNumber(hash, k.ringing);
  hash = hashNumber(hash, k.colorDrift);
  hash = hashNumber(hash, k.chromaBleed);
  hash = hashNumber(hash, k.bitCrush);
  hash = hashNumber(hash, k.blockEcho);
  hash = hashNumber(hash, k.echoBeforeJpeg);
  hash = hashNumber(hash, k.dcStep);
  hash = hashNumber(hash, k.phaseShift);
  hash = hashNumber(hash, k.invertDct);
  hash = hashNumber(hash, k.lockChroma);
  hash = hashNumber(hash, k.huffmanDesync);
  hash = hashNumber(hash, k.huffmanShift);
  return hashNumber(hash, k.huffmanCorrupt);
}
