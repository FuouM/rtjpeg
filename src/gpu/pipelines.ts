import jpegComputeShader from "../shaders/jpeg_compute.wgsl?raw";
import quadShader from "../shaders/quad.wgsl?raw";

export function createComputePipelines(device: GPUDevice) {
  // Patch texture_external → texture_2d<f32> — the external-texture path is never
  // used (video is always uploaded to a GPUTexture first for cache/ping-pong reasons).
  const jpegComputeShader2D = jpegComputeShader
    .replace(
      "var inputTex: texture_external;",
      "var inputTex: texture_2d<f32>;",
    )
    .replace(
      "fn load_external_clamped(tex: texture_external, src_px: vec2<u32>, src_dims: vec2<u32>) -> vec3<f32> {",
      "fn load_external_clamped(tex: texture_2d<f32>, src_px: vec2<u32>, src_dims: vec2<u32>) -> vec3<f32> {",
    )
    .replace(
      "fn load_video_at_output_px(tex: texture_external, out_px: vec2<u32>, src_dims: vec2<u32>, out_dims: vec2<u32>) -> vec3<f32> {",
      "fn load_video_at_output_px(tex: texture_2d<f32>, out_px: vec2<u32>, src_dims: vec2<u32>, out_dims: vec2<u32>) -> vec3<f32> {",
    )
    .replace(
      "return textureLoad(tex, vec2<i32>(i32(cx), i32(cy))).rgb;",
      "return textureLoad(tex, vec2<i32>(i32(cx), i32(cy)), 0).rgb;",
    );

  const computeModule2D = device.createShaderModule({
    label: "JPEG Compute Shader 2D",
    code: jpegComputeShader2D,
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
