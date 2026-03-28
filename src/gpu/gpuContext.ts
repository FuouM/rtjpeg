import { configureContext, initGPU } from "./gpu_utils";
import { createComputePipelines, createRenderPipeline } from "./pipelines";

/**
 * WebGPU device, swapchain, pipelines, uniform buffer, and texture pool for the main rtjpeg graph.
 * Ping-pong input textures are recreated by the render loop when source size changes.
 */
export class GpuContext {
  readonly device: GPUDevice;
  readonly context: GPUCanvasContext;
  readonly presentationFormat: GPUTextureFormat;
  readonly computePipeline2D: GPUComputePipeline;
  readonly computeLayout2D: GPUBindGroupLayout;
  readonly renderPipeline: GPURenderPipeline;
  readonly renderLayout: GPUBindGroupLayout;
  readonly sampler: GPUSampler;
  /** 6× vec4<f32> uniforms (effects params). */
  readonly paramsBuffer: GPUBuffer;
  /** 1×1 black — neutral previous-frame input before first real frame. */
  readonly neutralTexture: GPUTexture;
  readonly neutralTextureView: GPUTextureView;
  /** Buffer for intermediate Huffman-encoded bitstream. */
  encodedBitstream: GPUBuffer | null = null;
  /** Metadata for bitstream (offsets per block). */
  bitstreamMetadata: GPUBuffer | null = null;
  /** Pre-computed Huffman decoding LUTs. */
  huffmanLuts: GPUBuffer | null = null;

  storageTexture: GPUTexture | null = null;
  prevStorageTexture: GPUTexture | null = null;
  storageTextureView: GPUTextureView | null = null;
  prevStorageTextureView: GPUTextureView | null = null;

  currInputTexture: GPUTexture | null = null;
  prevInputTexture: GPUTexture | null = null;
  currInputTextureView: GPUTextureView | null = null;
  prevInputTextureView: GPUTextureView | null = null;

  /** Default fullscreen quad showing `storageTexture`. */
  renderBindGroup: GPUBindGroup | null = null;

  private constructor(init: {
    device: GPUDevice;
    context: GPUCanvasContext;
    presentationFormat: GPUTextureFormat;
    computePipeline2D: GPUComputePipeline;
    computeLayout2D: GPUBindGroupLayout;
    renderPipeline: GPURenderPipeline;
    renderLayout: GPUBindGroupLayout;
    sampler: GPUSampler;
    paramsBuffer: GPUBuffer;
    neutralTexture: GPUTexture;
    neutralTextureView: GPUTextureView;
  }) {
    this.device = init.device;
    this.context = init.context;
    this.presentationFormat = init.presentationFormat;
    this.computePipeline2D = init.computePipeline2D;
    this.computeLayout2D = init.computeLayout2D;
    this.renderPipeline = init.renderPipeline;
    this.renderLayout = init.renderLayout;
    this.sampler = init.sampler;
    this.paramsBuffer = init.paramsBuffer;
    this.neutralTexture = init.neutralTexture;
    this.neutralTextureView = init.neutralTextureView;
  }

  static async create(outputCanvas: HTMLCanvasElement): Promise<GpuContext> {
    const { device } = await initGPU();
    const { context, presentationFormat } = configureContext(
      outputCanvas,
      device,
    );
    const pipelines = createComputePipelines(device);
    const renderResult = createRenderPipeline(device, presentationFormat);

    const sampler = device.createSampler({
      magFilter: "linear",
      minFilter: "linear",
    });
    const paramsBuffer = device.createBuffer({
      size: 112, // 28 floats (7 vec4s)
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    const neutralTexture = device.createTexture({
      size: [1, 1, 1],
      format: "rgba8unorm",
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
    });
    const neutralTextureView = neutralTexture.createView();

    return new GpuContext({
      device,
      context,
      presentationFormat,
      computePipeline2D: pipelines.pipeline2D,
      computeLayout2D: pipelines.layout2D,
      renderPipeline: renderResult.pipeline,
      renderLayout: renderResult.layout,
      sampler,
      paramsBuffer,
      neutralTexture,
      neutralTextureView,
    });
  }

  /**
   * (Re)create storage + previous-frame textures and the default render bind group for the
   * current output pixel dimensions. Call after resizing the output canvas.
   */
  recreateStorageTextures(outputWidth: number, outputHeight: number): void {
    if (this.storageTexture) this.storageTexture.destroy();
    if (this.prevStorageTexture) this.prevStorageTexture.destroy();

    this.storageTexture = this.device.createTexture({
      size: [outputWidth, outputHeight],
      format: "rgba8unorm",
      usage:
        GPUTextureUsage.STORAGE_BINDING |
        GPUTextureUsage.TEXTURE_BINDING |
        GPUTextureUsage.COPY_SRC,
    });

    this.prevStorageTexture = this.device.createTexture({
      size: [outputWidth, outputHeight],
      format: "rgba8unorm",
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
    });

    this.storageTextureView = this.storageTexture.createView();
    this.prevStorageTextureView = this.prevStorageTexture.createView();

    this.renderBindGroup = this.device.createBindGroup({
      layout: this.renderLayout,
      entries: [
        { binding: 0, resource: this.sampler },
        { binding: 1, resource: this.storageTextureView },
      ],
    });
  }

  /**
   * (Re)create Huffman-related buffers for the current output dimensions.
   */
  recreateHuffmanBuffers(totalBlocks: number): void {
    if (this.encodedBitstream) this.encodedBitstream.destroy();
    if (this.bitstreamMetadata) this.bitstreamMetadata.destroy();
    if (this.huffmanLuts) this.huffmanLuts.destroy();

    // Max 1024 bytes per block (over-allocation for safety in glitches)
    // 3x to accommodate Y, Cb, and Cr
    this.encodedBitstream = this.device.createBuffer({
      size: totalBlocks * 1024 * 3,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST,
    });

    // 2x u32 per block: [bitOffset, bitLength]
    // 3x to accommodate Y, Cb, and Cr
    this.bitstreamMetadata = this.device.createBuffer({
      size: totalBlocks * 8 * 3,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST,
    });

    // Pre-computed tables (approx 1.2MB for 16-bit LUTs)
    this.huffmanLuts = this.device.createBuffer({
      size: 2 * 1024 * 1024, // 2MB
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
  }
}
