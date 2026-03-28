import {
  decodeBase64Url,
  encodeBase64Url,
  MAX_BASE64URL_DECODE_INPUT_CHARS,
} from "../lib/base64Url";

export const SIDEBAR_PRESET_STORAGE_KEY = "rtjpeg.sidebarPresets.v1";
export const SIDEBAR_PRESET_EXPORT_PREFIX = "rtjpeg:preset:v1:";
/** Fragment after `#` — full hash is `#${SIDEBAR_PRESET_URL_HASH_PREFIX}<encodeURIComponent(payload)>`. */
export const SIDEBAR_PRESET_URL_HASH_PREFIX = "rtjpeg-preset=";
/** Reject absurdly large imports (URL hash, paste, file) before base64/JSON work. */
export const MAX_PRESET_IMPORT_STRING_LENGTH = 256 * 1024;
export const MAX_PRESET_NAME_LENGTH = 40;
export const MAX_PRESET_SEED = 2147483647;

export interface SidebarPresetValues {
  quality: number;
  scaleIndex: number;
  chromaMode: number;
  glitch: number;
  mosh: number;
  datamosh: number;
  corrupt: number;
  ringing: number;
  colorDrift: boolean;
  chromaBleed: number;
  bitCrush: number;
  blockEcho: number;
  echoBeforeJpeg: boolean;
  seed: number;
  dcStep: number;
  phaseShift: number;
  invertDct: boolean;
  lockChroma: number;
  huffmanDesync: number;
  huffmanCorrupt: number;
}

export interface SidebarPresetRecord {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  values: SidebarPresetValues;
}

export interface SidebarPresetExport {
  type: "rtjpeg-sidebar-preset";
  version: 1;
  name: string | null;
  values: SidebarPresetValues;
}

export const DEFAULT_SIDEBAR_PRESET_VALUES: SidebarPresetValues = {
  quality: 10,
  scaleIndex: 1,
  chromaMode: 2,
  glitch: 0,
  mosh: 0,
  datamosh: 0,
  corrupt: 0,
  ringing: 1,
  colorDrift: false,
  chromaBleed: 0,
  bitCrush: 0,
  blockEcho: 0,
  echoBeforeJpeg: false,
  seed: -1,
  dcStep: 0,
  phaseShift: 0,
  invertDct: false,
  lockChroma: 0,
  huffmanDesync: 0,
  huffmanCorrupt: 0,
};

function clampInteger(value: unknown, min: number, max: number): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return Math.min(max, Math.max(min, Math.round(value)));
}

function clampNumber(
  value: unknown,
  min: number,
  max: number,
  decimals = 1,
): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  const clamped = Math.min(max, Math.max(min, value));
  const factor = 10 ** decimals;
  return Math.round(clamped * factor) / factor;
}

function readBoolean(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

export function sanitizePresetName(raw: string): string {
  const compact = raw.replace(/\s+/g, " ").trim();
  return compact.slice(0, MAX_PRESET_NAME_LENGTH);
}

export function normalizeSeedValue(raw: number): number {
  if (!Number.isFinite(raw)) return -1;
  const rounded = Math.round(raw);
  if (rounded === -1) return -1;
  if (rounded < 0) return 0;
  return Math.min(MAX_PRESET_SEED, rounded);
}

export function normalizeSidebarPresetValues(
  input: unknown,
): SidebarPresetValues | null {
  if (!isRecord(input)) return null;

  const quality = clampInteger(input.quality, 1, 100);
  const scaleIndex = clampInteger(input.scaleIndex, 0, 4);
  const chromaMode = clampInteger(input.chromaMode, 0, 3);
  const glitch = clampInteger(input.glitch, 0, 100);
  const mosh = clampInteger(input.mosh, 0, 100);
  const datamosh = clampInteger(input.datamosh, 0, 100);
  const corrupt = clampInteger(input.corrupt, 0, 100);
  const ringing = clampNumber(input.ringing, 1, 10);
  const colorDrift = readBoolean(input.colorDrift);
  const chromaBleed = clampInteger(input.chromaBleed, 0, 100);
  const bitCrush = clampInteger(input.bitCrush, 0, 100);
  const blockEcho = clampInteger(input.blockEcho, 0, 100);
  const echoBeforeJpeg = readBoolean(input.echoBeforeJpeg);
  const dcStep = clampInteger(input.dcStep, 0, 100);
  const phaseShift = clampInteger(input.phaseShift, 0, 100);
  const invertDct = readBoolean(input.invertDct);
  const lockChroma = clampInteger(input.lockChroma, 0, 100);
  const huffmanDesync = clampInteger(input.huffmanDesync, 0, 100);
  const huffmanCorrupt = clampInteger(input.huffmanCorrupt, 0, 100);

  const seedValue =
    typeof input.seed === "number" && Number.isFinite(input.seed)
      ? normalizeSeedValue(input.seed)
      : null;

  if (
    quality === null ||
    scaleIndex === null ||
    chromaMode === null ||
    glitch === null ||
    mosh === null ||
    datamosh === null ||
    corrupt === null ||
    ringing === null ||
    colorDrift === null ||
    chromaBleed === null ||
    bitCrush === null ||
    blockEcho === null ||
    echoBeforeJpeg === null ||
    dcStep === null ||
    phaseShift === null ||
    invertDct === null ||
    lockChroma === null ||
    huffmanDesync === null ||
    huffmanCorrupt === null ||
    seedValue === null
  ) {
    return null;
  }

  return {
    quality,
    scaleIndex,
    chromaMode,
    glitch,
    mosh,
    datamosh,
    corrupt,
    ringing,
    colorDrift,
    chromaBleed,
    bitCrush,
    blockEcho,
    echoBeforeJpeg,
    seed: seedValue,
    dcStep,
    phaseShift,
    invertDct,
    lockChroma,
    huffmanDesync,
    huffmanCorrupt,
  };
}

export function normalizeSidebarPresetRecord(
  input: unknown,
): SidebarPresetRecord | null {
  if (!isRecord(input)) return null;
  if (typeof input.id !== "string" || input.id.trim() === "") return null;
  if (typeof input.name !== "string") return null;
  if (
    typeof input.createdAt !== "string" ||
    typeof input.updatedAt !== "string"
  )
    return null;

  const name = sanitizePresetName(input.name);
  const values = normalizeSidebarPresetValues(input.values);
  if (!name || !values) return null;

  return {
    id: input.id,
    name,
    createdAt: input.createdAt,
    updatedAt: input.updatedAt,
    values,
  };
}

export function createSidebarPresetExport(
  values: SidebarPresetValues,
  name?: string | null,
): SidebarPresetExport {
  return {
    type: "rtjpeg-sidebar-preset",
    version: 1,
    name: name ? sanitizePresetName(name) || null : null,
    values,
  };
}

export function parseSidebarPresetExport(
  input: unknown,
): SidebarPresetExport | null {
  if (!isRecord(input)) return null;
  if (input.type !== "rtjpeg-sidebar-preset" || input.version !== 1)
    return null;

  const name =
    input.name == null
      ? null
      : typeof input.name === "string"
        ? sanitizePresetName(input.name) || null
        : null;
  const values = normalizeSidebarPresetValues(input.values);
  if (!values) return null;

  return {
    type: "rtjpeg-sidebar-preset",
    version: 1,
    name,
    values,
  };
}

export function formatSidebarPresetExportString(
  data: SidebarPresetExport,
): string {
  return `${SIDEBAR_PRESET_EXPORT_PREFIX}${encodeBase64Url(
    JSON.stringify(data),
  )}`;
}

export function parseSidebarPresetPayload(
  raw: string,
): SidebarPresetExport | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (trimmed.length > MAX_PRESET_IMPORT_STRING_LENGTH) return null;

  try {
    if (trimmed.startsWith(SIDEBAR_PRESET_EXPORT_PREFIX)) {
      const b64 = trimmed.slice(SIDEBAR_PRESET_EXPORT_PREFIX.length);
      if (b64.length > MAX_BASE64URL_DECODE_INPUT_CHARS) return null;
      const decoded = decodeBase64Url(b64);
      if (decoded.length > MAX_PRESET_IMPORT_STRING_LENGTH) return null;
      return parseSidebarPresetExport(JSON.parse(decoded));
    }
    return parseSidebarPresetExport(JSON.parse(trimmed));
  } catch {
    return null;
  }
}

/** If the user pasted or scanned a share link, pull the preset token out of the hash. */
export function extractPresetPayloadFromImportString(raw: string): string {
  const trimmed = raw.trim();
  const decodeHashBody = (body: string): string | null => {
    if (!body.startsWith(SIDEBAR_PRESET_URL_HASH_PREFIX)) return null;
    const encoded = body.slice(SIDEBAR_PRESET_URL_HASH_PREFIX.length);
    if (encoded.length > MAX_PRESET_IMPORT_STRING_LENGTH) return null;
    try {
      const decoded = decodeURIComponent(encoded);
      if (decoded.length > MAX_PRESET_IMPORT_STRING_LENGTH) return null;
      return decoded;
    } catch {
      return null;
    }
  };

  try {
    const u = new URL(trimmed);
    const h = u.hash.startsWith("#") ? u.hash.slice(1) : u.hash;
    const fromAbs = decodeHashBody(h);
    if (fromAbs) return fromAbs;
  } catch {
    /* not an absolute URL */
  }

  try {
    const u = new URL(trimmed, window.location.origin);
    const h = u.hash.startsWith("#") ? u.hash.slice(1) : u.hash;
    const fromRel = decodeHashBody(h);
    if (fromRel) return fromRel;
  } catch {
    /* ignore */
  }

  if (trimmed.startsWith("#")) {
    const h = trimmed.slice(1);
    const fromBare = decodeHashBody(h);
    if (fromBare) return fromBare;
  }

  return trimmed;
}

export function buildPresetFilename(name: string, extension: string): string {
  const base = sanitizePresetName(name) || "preset";
  const safe =
    base
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "preset";
  return `rtjpeg_${safe}.${extension}`;
}

export function buildPresetQrFilename(name: string): string {
  const base = sanitizePresetName(name) || "preset";
  const safe =
    base
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "preset";
  return `rtjpeg_${safe}_qr.png`;
}
