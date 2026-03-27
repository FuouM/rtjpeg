/** True when the WebGPU API is present (browser support); adapter/device may still fail. */
export function isWebGPUAvailable(): boolean {
  return typeof navigator !== "undefined" && !!navigator.gpu;
}

export async function initGPU() {
  if (!navigator.gpu) {
    throw new Error("WebGPU not supported on this browser.");
  }

  const adapter = await navigator.gpu.requestAdapter();
  if (!adapter) {
    throw new Error("No appropriate GPU adapter found.");
  }

  const device = await adapter.requestDevice();
  return { adapter, device };
}

export function configureContext(canvas: HTMLCanvasElement, device: GPUDevice) {
  const context = canvas.getContext("webgpu") as GPUCanvasContext;
  const presentationFormat = navigator.gpu.getPreferredCanvasFormat();

  context.configure({
    device,
    format: presentationFormat,
    alphaMode: "premultiplied",
  });

  return { context, presentationFormat };
}
