import { downloadBlob } from "../lib/downloadBlob";
import {
  PRESET_CHOOSER_CURRENT,
  PRESET_CHOOSER_DEFAULTS,
} from "../runtime/constants";
import type { BarcodeDetectorCtor } from "../runtime/types";
import {
  buildPresetFilename,
  buildPresetQrFilename,
  createSidebarPresetExport,
  DEFAULT_SIDEBAR_PRESET_VALUES,
  extractPresetPayloadFromImportString,
  formatSidebarPresetExportString,
  MAX_PRESET_IMPORT_STRING_LENGTH,
  normalizeSidebarPresetRecord,
  parseSidebarPresetPayload,
  sanitizePresetName,
  SIDEBAR_PRESET_STORAGE_KEY,
  SIDEBAR_PRESET_URL_HASH_PREFIX,
  type SidebarPresetExport,
  type SidebarPresetRecord,
  type SidebarPresetValues,
} from "./sidebarPresets";

export interface PresetManagerDeps {
  presetChooser: HTMLSelectElement;
  presetManageBtn: HTMLButtonElement;
  presetModal: HTMLDivElement;
  presetCloseBtn: HTMLButtonElement;
  presetStatus: HTMLElement;
  presetNameInput: HTMLInputElement;
  presetSaveBtn: HTMLButtonElement;
  presetUpdateBtn: HTMLButtonElement;
  presetDeleteBtn: HTMLButtonElement;
  presetExportText: HTMLTextAreaElement;
  presetDownloadJsonBtn: HTMLButtonElement;
  presetCopyBase64Btn: HTMLButtonElement;
  presetQrImage: HTMLImageElement;
  presetCopyQrBtn: HTMLButtonElement;
  presetSaveQrBtn: HTMLButtonElement;
  presetImportText: HTMLTextAreaElement;
  presetImportBtn: HTMLButtonElement;
  presetImportFileBtn: HTMLButtonElement;
  presetImportFileInput: HTMLInputElement;
  presetCopyLinkBtn: HTMLButtonElement;
  presetShareLinkBtn: HTMLButtonElement;
  presetImportPasteBtn: HTMLButtonElement;
  presetImportQrBtn: HTMLButtonElement;
  presetImportQrInput: HTMLInputElement;
  resetParamsBtn: HTMLButtonElement;

  getSavedSidebarPresets: () => SidebarPresetRecord[];
  setSavedSidebarPresets: (v: SidebarPresetRecord[]) => void;
  getPresetChooserSelection: () => string;
  setPresetChooserSelection: (v: string) => void;
  bumpPresetQrSyncToken: () => number;
  getPresetQrSyncToken: () => number;

  getCurrentSidebarPresetValues: () => SidebarPresetValues;
  applySidebarPresetValues: (values: SidebarPresetValues) => void;
}

function buildSidebarPresetExport(
  deps: PresetManagerDeps,
  name?: string | null,
): SidebarPresetExport {
  return createSidebarPresetExport(
    deps.getCurrentSidebarPresetValues(),
    name ?? null,
  );
}

function getSidebarPresetExportJson(
  deps: PresetManagerDeps,
  name?: string | null,
): string {
  return JSON.stringify(buildSidebarPresetExport(deps, name), null, 2);
}

function getSidebarPresetExportString(
  deps: PresetManagerDeps,
  name?: string | null,
): string {
  return formatSidebarPresetExportString(buildSidebarPresetExport(deps, name));
}

export function setPresetStatus(
  deps: PresetManagerDeps,
  message: string,
  tone: "neutral" | "success" | "error" = "neutral",
): void {
  deps.presetStatus.textContent = message;
  if (tone === "success") {
    deps.presetStatus.style.color = "var(--color-accent)";
    return;
  }
  if (tone === "error") {
    deps.presetStatus.style.color = "var(--color-accentDown)";
    return;
  }
  deps.presetStatus.style.color = "var(--color-subtitle)";
}

async function getPresetQrPngBlob(
  deps: PresetManagerDeps,
): Promise<Blob | null> {
  const src = deps.presetQrImage.src;
  if (!src || !src.startsWith("data:image")) return null;
  try {
    return await (await fetch(src)).blob();
  } catch {
    return null;
  }
}

export function getSelectedSavedPreset(
  deps: PresetManagerDeps,
): SidebarPresetRecord | null {
  const presetChooserSelection = deps.getPresetChooserSelection();
  if (
    presetChooserSelection === PRESET_CHOOSER_CURRENT ||
    presetChooserSelection === PRESET_CHOOSER_DEFAULTS
  ) {
    return null;
  }
  return (
    deps
      .getSavedSidebarPresets()
      .find((preset) => preset.id === presetChooserSelection) ?? null
  );
}

export function persistSidebarPresets(deps: PresetManagerDeps): void {
  try {
    localStorage.setItem(
      SIDEBAR_PRESET_STORAGE_KEY,
      JSON.stringify(deps.getSavedSidebarPresets()),
    );
  } catch (error) {
    console.error("Could not persist presets:", error);
    setPresetStatus(deps, "Could not save presets to local storage.", "error");
  }
}

export function refreshPresetChooser(deps: PresetManagerDeps): void {
  const nextValue = deps.getPresetChooserSelection();
  deps.presetChooser.innerHTML = "";

  const addOption = (value: string, label: string) => {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = label;
    deps.presetChooser.appendChild(option);
  };

  addOption(PRESET_CHOOSER_CURRENT, "Current");
  addOption(PRESET_CHOOSER_DEFAULTS, "Defaults");
  for (const preset of deps.getSavedSidebarPresets()) {
    addOption(preset.id, preset.name);
  }

  const valueExists = Array.from(deps.presetChooser.options).some(
    (option) => option.value === nextValue,
  );
  deps.setPresetChooserSelection(
    valueExists ? nextValue : PRESET_CHOOSER_CURRENT,
  );
  deps.presetChooser.value = deps.getPresetChooserSelection();
}

export function syncPresetManagerActionState(deps: PresetManagerDeps): void {
  const hasSavedSelection = getSelectedSavedPreset(deps) !== null;
  deps.presetUpdateBtn.disabled = !hasSavedSelection;
  deps.presetDeleteBtn.disabled = !hasSavedSelection;
  deps.presetUpdateBtn.style.opacity = hasSavedSelection ? "1" : "0.5";
  deps.presetDeleteBtn.style.opacity = hasSavedSelection ? "1" : "0.5";
}

export async function syncPresetExportArtifacts(
  deps: PresetManagerDeps,
): Promise<void> {
  const selectedPreset = getSelectedSavedPreset(deps);
  const name =
    sanitizePresetName(deps.presetNameInput.value) ||
    selectedPreset?.name ||
    "preset";
  const exportString = getSidebarPresetExportString(deps, name);
  deps.presetExportText.value = exportString;

  const shareUrl = getSidebarPresetShareUrl(deps);
  const ticket = deps.bumpPresetQrSyncToken();
  try {
    const { default: QRCode } = await import("qrcode");
    const dataUrl = await QRCode.toDataURL(shareUrl, {
      errorCorrectionLevel: "H",
      margin: 1,
      width: 256,
    });
    if (ticket !== deps.getPresetQrSyncToken()) return;
    deps.presetQrImage.src = dataUrl;
    deps.presetQrImage.classList.remove("hidden");
  } catch (error) {
    console.error("Could not render preset QR code:", error);
    if (ticket !== deps.getPresetQrSyncToken()) return;
    deps.presetQrImage.removeAttribute("src");
    deps.presetQrImage.classList.add("hidden");
  }
}

export function markPresetSelectionCurrent(deps: PresetManagerDeps): void {
  deps.setPresetChooserSelection(PRESET_CHOOSER_CURRENT);
  deps.presetChooser.value = deps.getPresetChooserSelection();
  if (!deps.presetModal.classList.contains("hidden")) {
    void syncPresetExportArtifacts(deps);
    syncPresetManagerActionState(deps);
  }
}

export function applyPresetSelection(
  deps: PresetManagerDeps,
  selection: string,
): void {
  if (selection === PRESET_CHOOSER_DEFAULTS) {
    deps.applySidebarPresetValues(DEFAULT_SIDEBAR_PRESET_VALUES);
    deps.setPresetChooserSelection(PRESET_CHOOSER_DEFAULTS);
    deps.presetChooser.value = deps.getPresetChooserSelection();
    deps.presetNameInput.value = "Defaults";
    setPresetStatus(deps, "Applied default sidebar parameters.", "success");
  } else {
    const preset = deps
      .getSavedSidebarPresets()
      .find((item) => item.id === selection);
    if (!preset) {
      markPresetSelectionCurrent(deps);
      setPresetStatus(deps, "Preset not found.", "error");
      return;
    }
    deps.applySidebarPresetValues(preset.values);
    deps.setPresetChooserSelection(preset.id);
    deps.presetChooser.value = deps.getPresetChooserSelection();
    deps.presetNameInput.value = preset.name;
    setPresetStatus(deps, `Applied "${preset.name}".`, "success");
  }

  void syncPresetExportArtifacts(deps);
  syncPresetManagerActionState(deps);
}

export function loadSavedSidebarPresets(deps: PresetManagerDeps): void {
  try {
    const raw = localStorage.getItem(SIDEBAR_PRESET_STORAGE_KEY);
    if (!raw) {
      deps.setSavedSidebarPresets([]);
      refreshPresetChooser(deps);
      return;
    }
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      deps.setSavedSidebarPresets([]);
      refreshPresetChooser(deps);
      return;
    }
    deps.setSavedSidebarPresets(
      parsed
        .map((item) => normalizeSidebarPresetRecord(item))
        .filter((item): item is SidebarPresetRecord => item !== null)
        .sort((a, b) => a.name.localeCompare(b.name)),
    );
  } catch (error) {
    console.error("Could not read presets:", error);
    deps.setSavedSidebarPresets([]);
  }

  refreshPresetChooser(deps);
}

export function openPresetManager(deps: PresetManagerDeps): void {
  const selectedPreset = getSelectedSavedPreset(deps);
  deps.presetNameInput.value = selectedPreset?.name ?? "";
  deps.presetImportText.value = "";
  deps.presetModal.classList.remove("hidden");
  deps.presetModal.classList.add("flex");
  syncPresetManagerActionState(deps);
  void syncPresetExportArtifacts(deps);
  setPresetStatus(
    deps,
    selectedPreset
      ? `Editing "${selectedPreset.name}".`
      : "Save local presets or import/export safe preset data.",
    "neutral",
  );
}

export function closePresetManager(deps: PresetManagerDeps): void {
  deps.presetModal.classList.add("hidden");
  deps.presetModal.classList.remove("flex");
}

export function getSidebarPresetShareUrl(deps: PresetManagerDeps): string {
  const name =
    sanitizePresetName(deps.presetNameInput.value) ||
    getSelectedSavedPreset(deps)?.name ||
    "preset";
  const payload = getSidebarPresetExportString(deps, name);
  const url = new URL(window.location.href);
  url.hash = `${SIDEBAR_PRESET_URL_HASH_PREFIX}${encodeURIComponent(payload)}`;
  return url.toString();
}

export function importPresetFromPayload(
  deps: PresetManagerDeps,
  payload: string,
  sourceLabel: string,
): void {
  const normalized = extractPresetPayloadFromImportString(payload);
  const parsed = parseSidebarPresetPayload(normalized);
  if (!parsed) {
    setPresetStatus(deps, `Could not import ${sourceLabel}.`, "error");
    return;
  }

  deps.applySidebarPresetValues(parsed.values);
  deps.setPresetChooserSelection(PRESET_CHOOSER_CURRENT);
  refreshPresetChooser(deps);
  deps.presetNameInput.value = parsed.name ?? "";
  deps.presetImportText.value = "";
  syncPresetManagerActionState(deps);
  void syncPresetExportArtifacts(deps);
  setPresetStatus(
    deps,
    `Imported ${sourceLabel}; save it locally if you want to keep it.`,
    "success",
  );
}

export function tryConsumePresetFromUrlHash(deps: PresetManagerDeps): boolean {
  const raw = window.location.hash;
  if (!raw.startsWith("#")) return false;
  const body = raw.slice(1);
  if (!body.startsWith(SIDEBAR_PRESET_URL_HASH_PREFIX)) return false;
  const encoded = body.slice(SIDEBAR_PRESET_URL_HASH_PREFIX.length);
  if (encoded.length > MAX_PRESET_IMPORT_STRING_LENGTH) return false;
  let payload: string;
  try {
    payload = decodeURIComponent(encoded);
  } catch {
    return false;
  }
  if (payload.length > MAX_PRESET_IMPORT_STRING_LENGTH) return false;
  if (!parseSidebarPresetPayload(payload)) return false;

  try {
    history.replaceState(
      null,
      "",
      `${window.location.pathname}${window.location.search}`,
    );
  } catch {
    /* ignore */
  }

  importPresetFromPayload(deps, payload, "shared link");
  return true;
}

export function setupPresetManagerListeners(deps: PresetManagerDeps): void {
  window.addEventListener("hashchange", () => {
    tryConsumePresetFromUrlHash(deps);
  });

  deps.presetChooser.addEventListener("change", () => {
    const selection = deps.presetChooser.value;
    if (selection === PRESET_CHOOSER_CURRENT) {
      deps.setPresetChooserSelection(PRESET_CHOOSER_CURRENT);
      deps.presetNameInput.value = "";
      setPresetStatus(deps, "Current unsaved settings selected.", "neutral");
      syncPresetManagerActionState(deps);
      void syncPresetExportArtifacts(deps);
      return;
    }
    applyPresetSelection(deps, selection);
  });

  deps.presetManageBtn.addEventListener("click", () => openPresetManager(deps));
  deps.presetCloseBtn.addEventListener("click", () => closePresetManager(deps));
  deps.presetModal.addEventListener("click", (event) => {
    if (event.target === deps.presetModal) closePresetManager(deps);
  });
  deps.presetNameInput.addEventListener("input", () => {
    deps.presetNameInput.value = sanitizePresetName(deps.presetNameInput.value);
    void syncPresetExportArtifacts(deps);
  });

  deps.presetSaveBtn.addEventListener("click", () => {
    const name = sanitizePresetName(deps.presetNameInput.value);
    if (!name) {
      setPresetStatus(deps, "Enter a preset name before saving.", "error");
      return;
    }

    const existingName = deps
      .getSavedSidebarPresets()
      .find((preset) => preset.name.toLowerCase() === name.toLowerCase());
    if (existingName) {
      setPresetStatus(deps, "A preset with that name already exists.", "error");
      return;
    }

    const now = new Date().toISOString();
    const preset: SidebarPresetRecord = {
      id: `preset_${crypto.randomUUID()}`,
      name,
      createdAt: now,
      updatedAt: now,
      values: deps.getCurrentSidebarPresetValues(),
    };

    deps.setSavedSidebarPresets(
      [...deps.getSavedSidebarPresets(), preset].sort((a, b) =>
        a.name.localeCompare(b.name),
      ),
    );
    deps.setPresetChooserSelection(preset.id);
    persistSidebarPresets(deps);
    refreshPresetChooser(deps);
    syncPresetManagerActionState(deps);
    void syncPresetExportArtifacts(deps);
    setPresetStatus(deps, `Saved "${preset.name}".`, "success");
  });

  deps.presetUpdateBtn.addEventListener("click", () => {
    const selectedPreset = getSelectedSavedPreset(deps);
    if (!selectedPreset) {
      setPresetStatus(deps, "Choose a saved preset to update.", "error");
      return;
    }

    const name =
      sanitizePresetName(deps.presetNameInput.value) || selectedPreset.name;
    const duplicate = deps
      .getSavedSidebarPresets()
      .find(
        (preset) =>
          preset.id !== selectedPreset.id &&
          preset.name.toLowerCase() === name.toLowerCase(),
      );
    if (duplicate) {
      setPresetStatus(
        deps,
        "A different preset already uses that name.",
        "error",
      );
      return;
    }

    deps.setSavedSidebarPresets(
      deps
        .getSavedSidebarPresets()
        .map((preset) =>
          preset.id === selectedPreset.id
            ? {
                ...preset,
                name,
                updatedAt: new Date().toISOString(),
                values: deps.getCurrentSidebarPresetValues(),
              }
            : preset,
        )
        .sort((a, b) => a.name.localeCompare(b.name)),
    );
    persistSidebarPresets(deps);
    refreshPresetChooser(deps);
    syncPresetManagerActionState(deps);
    void syncPresetExportArtifacts(deps);
    setPresetStatus(deps, `Updated "${name}".`, "success");
  });

  deps.presetDeleteBtn.addEventListener("click", () => {
    const selectedPreset = getSelectedSavedPreset(deps);
    if (!selectedPreset) {
      setPresetStatus(deps, "Choose a saved preset to delete.", "error");
      return;
    }
    if (!window.confirm(`Delete preset "${selectedPreset.name}"?`)) return;

    deps.setSavedSidebarPresets(
      deps
        .getSavedSidebarPresets()
        .filter((preset) => preset.id !== selectedPreset.id),
    );
    persistSidebarPresets(deps);
    deps.setPresetChooserSelection(PRESET_CHOOSER_CURRENT);
    refreshPresetChooser(deps);
    deps.presetNameInput.value = "";
    syncPresetManagerActionState(deps);
    void syncPresetExportArtifacts(deps);
    setPresetStatus(deps, `Deleted "${selectedPreset.name}".`, "success");
  });

  deps.presetDownloadJsonBtn.addEventListener("click", () => {
    const name =
      sanitizePresetName(deps.presetNameInput.value) ||
      getSelectedSavedPreset(deps)?.name ||
      "preset";
    const json = getSidebarPresetExportJson(deps, name);
    downloadBlob(
      new Blob([json], { type: "application/json" }),
      buildPresetFilename(name, "json"),
    );
    setPresetStatus(deps, "Downloaded preset JSON.", "success");
  });

  deps.presetCopyBase64Btn.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(deps.presetExportText.value);
      setPresetStatus(deps, "Copied base64 preset string.", "success");
    } catch (error) {
      console.error("Could not copy preset string:", error);
      setPresetStatus(deps, "Clipboard copy failed in this browser.", "error");
    }
  });

  deps.presetCopyLinkBtn.addEventListener("click", async () => {
    const url = getSidebarPresetShareUrl(deps);
    try {
      await navigator.clipboard.writeText(url);
      setPresetStatus(deps, "Copied shareable link.", "success");
    } catch (error) {
      console.error("Could not copy share link:", error);
      setPresetStatus(deps, "Could not copy link.", "error");
    }
  });

  deps.presetShareLinkBtn.addEventListener("click", async () => {
    const url = getSidebarPresetShareUrl(deps);
    if (!navigator.share) {
      try {
        await navigator.clipboard.writeText(url);
        setPresetStatus(
          deps,
          "Share not available; copied link instead.",
          "success",
        );
      } catch (error) {
        console.error(error);
        setPresetStatus(deps, "Share and clipboard both failed.", "error");
      }
      return;
    }
    try {
      await navigator.share({
        title: "RTJPEG preset",
        url,
        text: "Load this RTJPEG preset:",
      });
      setPresetStatus(deps, "Shared preset link.", "success");
    } catch (error) {
      if ((error as Error).name === "AbortError") return;
      console.error("Share failed:", error);
      setPresetStatus(deps, "Share failed.", "error");
    }
  });

  deps.presetCopyQrBtn.addEventListener("click", async () => {
    const blob = await getPresetQrPngBlob(deps);
    if (!blob) {
      setPresetStatus(deps, "No QR image to copy yet.", "error");
      return;
    }
    try {
      if (typeof ClipboardItem === "undefined" || !navigator.clipboard?.write) {
        setPresetStatus(
          deps,
          "Clipboard image copy is not supported in this browser.",
          "error",
        );
        return;
      }
      await navigator.clipboard.write([
        new ClipboardItem({ [blob.type]: blob }),
      ]);
      setPresetStatus(deps, "Copied QR image to clipboard.", "success");
    } catch (error) {
      console.error("Could not copy QR image:", error);
      setPresetStatus(deps, "Could not copy QR to clipboard.", "error");
    }
  });

  deps.presetSaveQrBtn.addEventListener("click", async () => {
    const blob = await getPresetQrPngBlob(deps);
    if (!blob) {
      setPresetStatus(deps, "No QR image to save yet.", "error");
      return;
    }
    const name =
      sanitizePresetName(deps.presetNameInput.value) ||
      getSelectedSavedPreset(deps)?.name ||
      "preset";
    downloadBlob(blob, buildPresetQrFilename(name));
    setPresetStatus(deps, "Saved QR as PNG.", "success");
  });

  deps.presetImportBtn.addEventListener("click", () => {
    importPresetFromPayload(deps, deps.presetImportText.value, "preset text");
  });

  deps.presetImportPasteBtn.addEventListener("click", async () => {
    try {
      const t = await navigator.clipboard.readText();
      deps.presetImportText.value = t;
      importPresetFromPayload(deps, t, "clipboard");
    } catch (error) {
      console.error("Clipboard read failed:", error);
      setPresetStatus(deps, "Clipboard read blocked or unavailable.", "error");
    }
  });

  deps.presetImportFileBtn.addEventListener("click", () => {
    deps.presetImportFileInput.click();
  });

  deps.presetImportFileInput.addEventListener("change", async () => {
    const file = deps.presetImportFileInput.files?.[0];
    deps.presetImportFileInput.value = "";
    if (!file) return;
    try {
      importPresetFromPayload(deps, await file.text(), `${file.name}`);
    } catch (error) {
      console.error("Could not read preset file:", error);
      setPresetStatus(deps, "Could not read preset file.", "error");
    }
  });

  deps.presetImportQrBtn.addEventListener("click", () => {
    deps.presetImportQrInput.click();
  });

  deps.presetImportQrInput.addEventListener("change", async () => {
    const file = deps.presetImportQrInput.files?.[0];
    deps.presetImportQrInput.value = "";
    if (!file) return;

    const BarcodeDetectorClass = (
      window as Window & { BarcodeDetector?: BarcodeDetectorCtor }
    ).BarcodeDetector;
    if (!BarcodeDetectorClass) {
      setPresetStatus(
        deps,
        "Decode QR needs Chrome/Edge (BarcodeDetector API).",
        "error",
      );
      return;
    }

    let objectUrl: string | null = null;
    try {
      objectUrl = URL.createObjectURL(file);
      const img = new Image();
      img.src = objectUrl;
      await img.decode();
      const detector = new BarcodeDetectorClass({ formats: ["qr_code"] });
      const codes = await detector.detect(img);
      const raw = codes[0]?.rawValue?.trim();
      if (!raw) {
        setPresetStatus(deps, "No QR code found in that image.", "error");
        return;
      }
      importPresetFromPayload(deps, raw, "QR image");
    } catch (error) {
      console.error("QR decode failed:", error);
      setPresetStatus(deps, "Could not read QR from image.", "error");
    } finally {
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    }
  });

  deps.resetParamsBtn.addEventListener("click", () => {
    deps.applySidebarPresetValues(DEFAULT_SIDEBAR_PRESET_VALUES);
    deps.setPresetChooserSelection(PRESET_CHOOSER_DEFAULTS);
    refreshPresetChooser(deps);
    deps.presetNameInput.value = "Defaults";
    syncPresetManagerActionState(deps);
    void syncPresetExportArtifacts(deps);
    setPresetStatus(deps, "Reset sidebar parameters to defaults.", "success");
  });
}
