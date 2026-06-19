import type { Mat2d, Size } from "@palmier/core";

// Shader for importExternalTexture path (zero-copy GPU-backed frames)
const WGSL_EXT = /* wgsl */ `
struct VertexOut {
  @builtin(position) pos: vec4f,
  @location(0) uv: vec2f,
};

struct Uniforms {
  a: f32, b: f32,
  c: f32, d: f32,
  e: f32, f: f32,
  natW: f32, natH: f32,
  canvasW: f32, canvasH: f32,
  _pad0: f32, _pad1: f32,
};

@group(0) @binding(0) var ext: texture_external;
@group(0) @binding(1) var samp: sampler;
@group(0) @binding(2) var<uniform> u: Uniforms;

@vertex
fn vs(@builtin(vertex_index) vi: u32) -> VertexOut {
  var quads = array<vec2f, 4>(
    vec2f(0.0, 0.0), vec2f(1.0, 0.0),
    vec2f(0.0, 1.0), vec2f(1.0, 1.0),
  );
  let uv = quads[vi];
  let sx = uv.x * u.natW;
  let sy = uv.y * u.natH;
  let cx = u.a * sx + u.c * sy + u.e;
  let cy = u.b * sx + u.d * sy + u.f;
  let ndcX = (cx / u.canvasW) * 2.0 - 1.0;
  let ndcY = 1.0 - (cy / u.canvasH) * 2.0;
  return VertexOut(vec4f(ndcX, ndcY, 0.0, 1.0), uv);
}

@fragment
fn fs(v: VertexOut) -> @location(0) vec4f {
  return textureSampleBaseClampToEdge(ext, samp, v.uv);
}
`;

// Shader for copyExternalImageToTexture path (software/CPU-backed frames)
const WGSL_TEX = /* wgsl */ `
struct VertexOut {
  @builtin(position) pos: vec4f,
  @location(0) uv: vec2f,
};

struct Uniforms {
  a: f32, b: f32,
  c: f32, d: f32,
  e: f32, f: f32,
  natW: f32, natH: f32,
  canvasW: f32, canvasH: f32,
  _pad0: f32, _pad1: f32,
};

@group(0) @binding(0) var tex: texture_2d<f32>;
@group(0) @binding(1) var samp: sampler;
@group(0) @binding(2) var<uniform> u: Uniforms;

@vertex
fn vs(@builtin(vertex_index) vi: u32) -> VertexOut {
  var quads = array<vec2f, 4>(
    vec2f(0.0, 0.0), vec2f(1.0, 0.0),
    vec2f(0.0, 1.0), vec2f(1.0, 1.0),
  );
  let uv = quads[vi];
  let sx = uv.x * u.natW;
  let sy = uv.y * u.natH;
  let cx = u.a * sx + u.c * sy + u.e;
  let cy = u.b * sx + u.d * sy + u.f;
  let ndcX = (cx / u.canvasW) * 2.0 - 1.0;
  let ndcY = 1.0 - (cy / u.canvasH) * 2.0;
  return VertexOut(vec4f(ndcX, ndcY, 0.0, 1.0), uv);
}

@fragment
fn fs(v: VertexOut) -> @location(0) vec4f {
  return textureSample(tex, samp, v.uv);
}
`;

export type ReadPixelFn = (x: number, y: number) => Promise<[number, number, number, number]>;

export class FrameRenderer {
  private device: GPUDevice;
  private ctx: GPUCanvasContext;
  // external-texture pipelines
  private extCanvasPipeline: GPURenderPipeline;
  private extReadbackPipeline: GPURenderPipeline;
  // copy-path pipelines
  private copyCanvasPipeline: GPURenderPipeline;
  private copyReadbackPipeline: GPURenderPipeline;
  private sampler: GPUSampler;
  private readbackTex: GPUTexture;
  private canvasFmt: GPUTextureFormat;
  // bind group layouts
  private extBgl: GPUBindGroupLayout;
  private copyBgl: GPUBindGroupLayout;

  private constructor(
    device: GPUDevice,
    ctx: GPUCanvasContext,
    extCanvasPipeline: GPURenderPipeline,
    extReadbackPipeline: GPURenderPipeline,
    copyCanvasPipeline: GPURenderPipeline,
    copyReadbackPipeline: GPURenderPipeline,
    sampler: GPUSampler,
    readbackTex: GPUTexture,
    canvasFmt: GPUTextureFormat,
    extBgl: GPUBindGroupLayout,
    copyBgl: GPUBindGroupLayout,
  ) {
    this.device = device;
    this.ctx = ctx;
    this.extCanvasPipeline = extCanvasPipeline;
    this.extReadbackPipeline = extReadbackPipeline;
    this.copyCanvasPipeline = copyCanvasPipeline;
    this.copyReadbackPipeline = copyReadbackPipeline;
    this.sampler = sampler;
    this.readbackTex = readbackTex;
    this.canvasFmt = canvasFmt;
    this.extBgl = extBgl;
    this.copyBgl = copyBgl;
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

    const extModule = device.createShaderModule({ code: WGSL_EXT });
    const texModule = device.createShaderModule({ code: WGSL_TEX });

    const extBgl = device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.FRAGMENT, externalTexture: {} },
        { binding: 1, visibility: GPUShaderStage.FRAGMENT, sampler: {} },
        { binding: 2, visibility: GPUShaderStage.VERTEX, buffer: { type: "uniform" } },
      ],
    });

    const copyBgl = device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: "float" } },
        { binding: 1, visibility: GPUShaderStage.FRAGMENT, sampler: {} },
        { binding: 2, visibility: GPUShaderStage.VERTEX, buffer: { type: "uniform" } },
      ],
    });

    const extLayout = device.createPipelineLayout({ bindGroupLayouts: [extBgl] });
    const copyLayout = device.createPipelineLayout({ bindGroupLayouts: [copyBgl] });

    const makePipeline = (module: GPUShaderModule, layout: GPUPipelineLayout, fmt: GPUTextureFormat): GPURenderPipeline =>
      device.createRenderPipeline({
        layout,
        vertex: { module, entryPoint: "vs" },
        fragment: { module, entryPoint: "fs", targets: [{ format: fmt }] },
        primitive: { topology: "triangle-strip" },
      });

    const extCanvasPipeline = makePipeline(extModule, extLayout, canvasFmt);
    const extReadbackPipeline = makePipeline(extModule, extLayout, "rgba8unorm");
    const copyCanvasPipeline = makePipeline(texModule, copyLayout, canvasFmt);
    const copyReadbackPipeline = makePipeline(texModule, copyLayout, "rgba8unorm");

    const sampler = device.createSampler({ minFilter: "linear", magFilter: "linear" });

    const cw = canvas.width;
    const ch = canvas.height;
    const readbackTex = device.createTexture({
      size: [cw, ch],
      format: "rgba8unorm",
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
    });

    return new FrameRenderer(
      device, ctx,
      extCanvasPipeline, extReadbackPipeline,
      copyCanvasPipeline, copyReadbackPipeline,
      sampler, readbackTex, canvasFmt,
      extBgl, copyBgl,
    );
  }

  async present(frame: VideoFrame, mat: Mat2d, renderSize: Size): Promise<void> {
    const device = this.device;
    const natW = frame.displayWidth;
    const natH = frame.displayHeight;

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

    // Try importExternalTexture first (zero-copy GPU-backed frames).
    // Falls back to VideoFrame.copyTo + writeTexture for software-backed frames.
    let extTex: GPUExternalTexture | null = null;
    try {
      extTex = device.importExternalTexture({ source: frame });
    } catch {
      // frame has no GPU back resource; use software copy path below
    }

    if (extTex !== null) {
      const capturedExtTex = extTex;
      const makeBg = (pipeline: GPURenderPipeline): GPUBindGroup =>
        device.createBindGroup({
          layout: this.extBgl,
          entries: [
            { binding: 0, resource: capturedExtTex },
            { binding: 1, resource: this.sampler },
            { binding: 2, resource: { buffer: uBuf } },
          ],
        });

      const encoder = device.createCommandEncoder();
      {
        const pass = encoder.beginRenderPass({
          colorAttachments: [{
            view: this.ctx.getCurrentTexture().createView(),
            clearValue: { r: 0, g: 0, b: 0, a: 1 },
            loadOp: "clear",
            storeOp: "store",
          }],
        });
        pass.setPipeline(this.extCanvasPipeline);
        pass.setBindGroup(0, makeBg(this.extCanvasPipeline));
        pass.draw(4);
        pass.end();
      }
      {
        const pass = encoder.beginRenderPass({
          colorAttachments: [{
            view: this.readbackTex.createView(),
            clearValue: { r: 0, g: 0, b: 0, a: 1 },
            loadOp: "clear",
            storeOp: "store",
          }],
        });
        pass.setPipeline(this.extReadbackPipeline);
        pass.setBindGroup(0, makeBg(this.extReadbackPipeline));
        pass.draw(4);
        pass.end();
      }
      device.queue.submit([encoder.finish()]);
    } else {
      // Software-copy path: VideoFrame.copyTo → RGBA pixels → writeTexture → sample as texture_2d
      // bytesPerRow must be 256-aligned for writeTexture; copyTo accepts any value >= natW*4
      const unpadded = natW * 4;
      const bytesPerRow = Math.ceil(unpadded / 256) * 256;
      const pixelBuf = new Uint8Array(bytesPerRow * natH);
      await frame.copyTo(pixelBuf, { format: "RGBA", layout: [{ offset: 0, stride: bytesPerRow }] });

      const frameTex = device.createTexture({
        size: [natW, natH],
        format: "rgba8unorm",
        usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
      });
      try {
        device.queue.writeTexture(
          { texture: frameTex },
          pixelBuf,
          { bytesPerRow },
          [natW, natH],
        );

        const makeBg = (pipeline: GPURenderPipeline): GPUBindGroup =>
          device.createBindGroup({
            layout: this.copyBgl,
            entries: [
              { binding: 0, resource: frameTex.createView() },
              { binding: 1, resource: this.sampler },
              { binding: 2, resource: { buffer: uBuf } },
            ],
          });

        const encoder = device.createCommandEncoder();
        {
          const pass = encoder.beginRenderPass({
            colorAttachments: [{
              view: this.ctx.getCurrentTexture().createView(),
              clearValue: { r: 0, g: 0, b: 0, a: 1 },
              loadOp: "clear",
              storeOp: "store",
            }],
          });
          pass.setPipeline(this.copyCanvasPipeline);
          pass.setBindGroup(0, makeBg(this.copyCanvasPipeline));
          pass.draw(4);
          pass.end();
        }
        {
          const pass = encoder.beginRenderPass({
            colorAttachments: [{
              view: this.readbackTex.createView(),
              clearValue: { r: 0, g: 0, b: 0, a: 1 },
              loadOp: "clear",
              storeOp: "store",
            }],
          });
          pass.setPipeline(this.copyReadbackPipeline);
          pass.setBindGroup(0, makeBg(this.copyReadbackPipeline));
          pass.draw(4);
          pass.end();
        }
        device.queue.submit([encoder.finish()]);
      } finally {
        frameTex.destroy();
      }
    }
    uBuf.destroy();
  }

  async readPixel(x: number, y: number): Promise<[number, number, number, number]> {
    const device = this.device;
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
    buf.destroy();
    return pixel;
  }

  resize(w: number, h: number): void {
    const canvas = this.ctx.canvas as HTMLCanvasElement;
    canvas.width = w;
    canvas.height = h;
    this.readbackTex.destroy();
    this.readbackTex = this.device.createTexture({
      size: [w, h],
      format: "rgba8unorm",
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
    });
    this.ctx.configure({ device: this.device, format: this.canvasFmt, alphaMode: "opaque" });
  }

  dispose(): void {
    this.readbackTex.destroy();
    this.device.destroy();
  }
}

export function readPixelFactory(renderer: FrameRenderer): ReadPixelFn {
  return (x, y) => renderer.readPixel(x, y);
}
