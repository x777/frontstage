import type { Mat2d, Size } from "@palmier/core";

const WGSL = /* wgsl */ `
struct VertexOut {
  @builtin(position) pos: vec4f,
  @location(0) uv: vec2f,
};

struct Uniforms {
  // Mat2d affine: maps (x_src_px, y_src_px) → (x_canvas_px, y_canvas_px)
  a: f32, b: f32,
  c: f32, d: f32,
  e: f32, f: f32,
  // Source natural size in pixels
  natW: f32, natH: f32,
  // Canvas size in pixels
  canvasW: f32, canvasH: f32,
  _pad0: f32, _pad1: f32,
};

@group(0) @binding(0) var ext: texture_external;
@group(0) @binding(1) var samp: sampler;
@group(0) @binding(2) var<uniform> u: Uniforms;

@vertex
fn vs(@builtin(vertex_index) vi: u32) -> VertexOut {
  // Full-screen quad UVs — texture sample coords in [0,1]
  var quads = array<vec2f, 4>(
    vec2f(0.0, 0.0), vec2f(1.0, 0.0),
    vec2f(0.0, 1.0), vec2f(1.0, 1.0),
  );
  let uv = quads[vi];

  // Convert UV → source pixel → canvas pixel via affine matrix
  let sx = uv.x * u.natW;
  let sy = uv.y * u.natH;
  let cx = u.a * sx + u.c * sy + u.e;
  let cy = u.b * sx + u.d * sy + u.f;

  // Canvas pixel → NDC
  let ndcX = (cx / u.canvasW) * 2.0 - 1.0;
  let ndcY = 1.0 - (cy / u.canvasH) * 2.0;

  return VertexOut(vec4f(ndcX, ndcY, 0.0, 1.0), uv);
}

@fragment
fn fs(v: VertexOut) -> @location(0) vec4f {
  return textureSampleBaseClampToEdge(ext, samp, v.uv);
}
`;

export type ReadPixelFn = (x: number, y: number) => Promise<[number, number, number, number]>;

export class FrameRenderer {
  private device: GPUDevice;
  private ctx: GPUCanvasContext;
  private canvasPipeline: GPURenderPipeline;
  private readbackPipeline: GPURenderPipeline;
  private sampler: GPUSampler;
  private readbackTex: GPUTexture;
  private cw: number;
  private ch: number;

  private constructor(
    device: GPUDevice,
    ctx: GPUCanvasContext,
    canvasPipeline: GPURenderPipeline,
    readbackPipeline: GPURenderPipeline,
    sampler: GPUSampler,
    readbackTex: GPUTexture,
    cw: number,
    ch: number,
  ) {
    this.device = device;
    this.ctx = ctx;
    this.canvasPipeline = canvasPipeline;
    this.readbackPipeline = readbackPipeline;
    this.sampler = sampler;
    this.readbackTex = readbackTex;
    this.cw = cw;
    this.ch = ch;
  }

  static async create(canvas: HTMLCanvasElement): Promise<FrameRenderer> {
    if (!navigator.gpu) throw new Error("WebGPU not supported");
    let adapter = await navigator.gpu.requestAdapter({ powerPreference: "low-power" });
    if (!adapter) adapter = await navigator.gpu.requestAdapter({ forceFallbackAdapter: true });
    if (!adapter) throw new Error("No WebGPU adapter");
    const device = await adapter.requestDevice();

    const canvasFmt = navigator.gpu.getPreferredCanvasFormat();
    const ctx = canvas.getContext("webgpu")!;
    ctx.configure({ device, format: canvasFmt, alphaMode: "opaque" });

    const module = device.createShaderModule({ code: WGSL });

    const bgl = device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.FRAGMENT, externalTexture: {} },
        { binding: 1, visibility: GPUShaderStage.FRAGMENT, sampler: {} },
        { binding: 2, visibility: GPUShaderStage.VERTEX, buffer: { type: "uniform" } },
      ],
    });

    const layout = device.createPipelineLayout({ bindGroupLayouts: [bgl] });

    const makePipeline = (fmt: GPUTextureFormat): GPURenderPipeline =>
      device.createRenderPipeline({
        layout,
        vertex: { module, entryPoint: "vs" },
        fragment: { module, entryPoint: "fs", targets: [{ format: fmt }] },
        primitive: { topology: "triangle-strip" },
      });

    const canvasPipeline = makePipeline(canvasFmt);
    const readbackPipeline = makePipeline("rgba8unorm");

    const sampler = device.createSampler({ minFilter: "linear", magFilter: "linear" });

    const cw = canvas.width;
    const ch = canvas.height;
    const readbackTex = device.createTexture({
      size: [cw, ch],
      format: "rgba8unorm",
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
    });

    return new FrameRenderer(device, ctx, canvasPipeline, readbackPipeline, sampler, readbackTex, cw, ch);
  }

  present(frame: VideoFrame, mat: Mat2d, renderSize: Size): void {
    const device = this.device;
    const natW = frame.displayWidth;
    const natH = frame.displayHeight;

    // Uniform buffer: Mat2d (6 floats) + natSize (2 floats) + canvasSize (2 floats) + 2 pad = 12 floats = 48 bytes
    const uData = new Float32Array([
      mat.a, mat.b,
      mat.c, mat.d,
      mat.e, mat.f,
      natW, natH,
      renderSize.width, renderSize.height,
      0, 0,
    ]);
    const uBuf = device.createBuffer({
      size: uData.byteLength,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    device.queue.writeBuffer(uBuf, 0, uData);

    // importExternalTexture expires after submit — import and submit must be synchronous
    const extTex = device.importExternalTexture({ source: frame });

    const makeBg = (pipeline: GPURenderPipeline): GPUBindGroup =>
      device.createBindGroup({
        layout: pipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: extTex },
          { binding: 1, resource: this.sampler },
          { binding: 2, resource: { buffer: uBuf } },
        ],
      });

    const encoder = device.createCommandEncoder();

    // Pass 1: display canvas
    {
      const pass = encoder.beginRenderPass({
        colorAttachments: [{
          view: this.ctx.getCurrentTexture().createView(),
          clearValue: { r: 0, g: 0, b: 0, a: 1 },
          loadOp: "clear",
          storeOp: "store",
        }],
      });
      pass.setPipeline(this.canvasPipeline);
      pass.setBindGroup(0, makeBg(this.canvasPipeline));
      pass.draw(4);
      pass.end();
    }

    // Pass 2: rgba8unorm readback texture
    {
      const pass = encoder.beginRenderPass({
        colorAttachments: [{
          view: this.readbackTex.createView(),
          clearValue: { r: 0, g: 0, b: 0, a: 1 },
          loadOp: "clear",
          storeOp: "store",
        }],
      });
      pass.setPipeline(this.readbackPipeline);
      pass.setBindGroup(0, makeBg(this.readbackPipeline));
      pass.draw(4);
      pass.end();
    }

    // Single submit — external texture valid for the entire synchronous block
    device.queue.submit([encoder.finish()]);
    uBuf.destroy();
  }

  async readPixel(x: number, y: number): Promise<[number, number, number, number]> {
    const device = this.device;
    // bytesPerRow must be a multiple of 256
    const bytesPerRow = 256;
    const buf = device.createBuffer({
      size: bytesPerRow,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    });
    const enc = device.createCommandEncoder();
    enc.copyTextureToBuffer(
      { texture: this.readbackTex, origin: { x, y, z: 0 } },
      { buffer: buf, bytesPerRow },
      [1, 1],
    );
    device.queue.submit([enc.finish()]);
    await buf.mapAsync(GPUMapMode.READ);
    const data = new Uint8Array(buf.getMappedRange(0, 4));
    const pixel: [number, number, number, number] = [data[0]!, data[1]!, data[2]!, data[3]!];
    buf.unmap();
    return pixel;
  }

  resize(w: number, h: number): void {
    this.cw = w;
    this.ch = h;
    const canvas = this.ctx.canvas as HTMLCanvasElement;
    canvas.width = w;
    canvas.height = h;
    this.readbackTex.destroy();
    this.readbackTex = this.device.createTexture({
      size: [w, h],
      format: "rgba8unorm",
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
    });
    const canvasFmt = navigator.gpu.getPreferredCanvasFormat();
    this.ctx.configure({ device: this.device, format: canvasFmt, alphaMode: "opaque" });
  }

  dispose(): void {
    this.readbackTex.destroy();
  }
}

export function readPixelFactory(renderer: FrameRenderer): ReadPixelFn {
  return (x, y) => renderer.readPixel(x, y);
}
