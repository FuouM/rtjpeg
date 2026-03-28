import jpegComputeShader from "../shaders/jpeg_compute.wgsl?raw";
import quadShader from "../shaders/quad.wgsl?raw";

export function createComputePipelines(device: GPUDevice) {
  const computeModule2D = device.createShaderModule({
    label: "JPEG Compute Shader 2D",
    code: jpegComputeShader,
  });

  const pipeline2D = device.createComputePipeline({
    label: "JPEG Compute Pipeline 2D",
    layout: "auto",
    compute: { module: computeModule2D, entryPoint: "compute_main" },
  });

  return {
    pipeline2D,
    layout2D: pipeline2D.getBindGroupLayout(0),
  };
}

export function createRenderPipeline(
  device: GPUDevice,
  presentationFormat: GPUTextureFormat,
) {
  const renderModule = device.createShaderModule({
    label: "Fullscreen Quad Shader",
    code: quadShader,
  });

  const pipeline = device.createRenderPipeline({
    label: "Video Render Pipeline",
    layout: "auto",
    vertex: { module: renderModule, entryPoint: "vert_main" },
    fragment: {
      module: renderModule,
      entryPoint: "frag_main",
      targets: [{ format: presentationFormat }],
    },
    primitive: { topology: "triangle-strip", stripIndexFormat: "uint32" },
  });

  return {
    pipeline,
    layout: pipeline.getBindGroupLayout(0),
  };
}
