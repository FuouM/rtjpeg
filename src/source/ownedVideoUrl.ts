/** Tracks an object URL we assigned to `<video>.src` so it can be revoked on replace/clear. */
export type OwnedObjectUrlRef = { current: string | null };

export function setVideoSrcWithOwnedUrl(
  video: HTMLVideoElement,
  url: string,
  ownsObjectUrl: boolean,
  ref: OwnedObjectUrlRef,
): void {
  if (ref.current && ref.current !== url) {
    URL.revokeObjectURL(ref.current);
  }
  ref.current = ownsObjectUrl ? url : null;
  video.preload = "auto";
  video.src = url;
}

export function clearVideoSrcRevokeOwned(
  video: HTMLVideoElement,
  ref: OwnedObjectUrlRef,
): void {
  if (ref.current) {
    URL.revokeObjectURL(ref.current);
    ref.current = null;
  }
  video.pause();
  video.removeAttribute("src");
  video.preload = "none";
  video.load();
}
