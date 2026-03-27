import { TRANSCODE_DISK_CACHE_NAME } from "../runtime/constants";

/** Deletes the Cache API bucket that stores transcoded MP4s from uploads (Firefox path). */
export async function clearTranscodedVideoDiskCache(): Promise<boolean> {
  if (!("caches" in window)) return false;
  try {
    return await caches.delete(TRANSCODE_DISK_CACHE_NAME);
  } catch {
    return false;
  }
}
