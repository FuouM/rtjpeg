export function showWebGPUUnsupportedBanner(detail: string): void {
  const banner = document.getElementById("webgpu-unsupported-banner");
  const detailEl = document.getElementById("webgpu-unsupported-detail");
  if (detailEl) detailEl.textContent = detail;
  banner?.classList.remove("hidden");
}
