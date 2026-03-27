export const SCALE_STEPS = [1, 2, 4, 8, 16] as const;

export const PRESET_CHOOSER_CURRENT = "__current__";
export const PRESET_CHOOSER_DEFAULTS = "__defaults__";

export const DEFAULT_CACHE_TEXT = "CACHED: 0 FRAMES";

export const CACHE_LIMIT_BYTES = 1000 * 1024 * 1024; // 1 GB
export const PROCESSED_LIMIT_BYTES = 1000 * 1024 * 1024; // 1 GB

/** FFmpeg.wasm and main-thread safety: reject larger uploads before work starts. */
export const MAX_USER_MEDIA_FILE_BYTES = 1024 * 1024 * 1024; // 1 GiB

export const sampleVideoUrl = `${import.meta.env.BASE_URL}cat_full.mp4`;

/** Cache API bucket for persisted transcoded MP4s (Firefox-safe upload path). */
export const TRANSCODE_DISK_CACHE_NAME = "rtjpeg-firefox-safe-video-v3";
