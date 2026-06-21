import type { Mat2d, Size } from "@palmier/core";
import type { CompositeLayer } from "./composite-layer.js";

// Uniforms layout (all f32, 64 bytes / 16 floats):
//   a, b, c, d, e, f        — affine matrix
//   natW, natH              — natural frame size
//   canvasW, canvasH        — render target size
//   opacity                 — per-layer opacity [0,1]
//   cropL, cropT, cropR, cropB — crop fractions [0,1)
//   _pad                    — alignment pad (total 16 × f32 = 64 bytes)
const UNIFORMS_F32 = 16;

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
  opacity: f32,
  cropL: f32, cropT: f32, cropR: f32, cropB: f32,
  _pad: f32,
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
  let cu = u.cropL + uv.x * (1.0 - u.cropL - u.cropR);
  let cv = u.cropT + uv.y * (1.0 - u.cropT - u.cropB);
  let sx = cu * u.natW;
  let sy = cv * u.natH;
  let cx = u.a * sx + u.c * sy + u.e;
  let cy = u.b * sx + u.d * sy + u.f;
  let ndcX = (cx / u.canvasW) * 2.0 - 1.0;
  let ndcY = 1.0 - (cy / u.canvasH) * 2.0;
  return VertexOut(vec4f(ndcX, ndcY, 0.0, 1.0), vec2f(cu, cv));
}

@fragment
fn fs(v: VertexOut) -> @location(0) vec4f {
  var rgba = textureSampleBaseClampToEdge(ext, samp, v.uv);
  rgba.a *= u.opacity;
  return rgba;
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
  opacity: f32,
  cropL: f32, cropT: f32, cropR: f32, cropB: f32,
  _pad: f32,
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
  let cu = u.cropL + uv.x * (1.0 - u.cropL - u.cropR);
  let cv = u.cropT + uv.y * (1.0 - u.cropT - u.cropB);
  let sx = cu * u.natW;
  let sy = cv * u.natH;
  let cx = u.a * sx + u.c * sy + u.e;
  let cy = u.b * sx + u.d * sy + u.f;
  let ndcX = (cx / u.canvasW) * 2.0 - 1.0;
  let ndcY = 1.0 - (cy / u.canvasH) * 2.0;
  return VertexOut(vec4f(ndcX, ndcY, 0.0, 1.0), vec2f(cu, cv));
}

@fragment
fn fs(v: VertexOut) -> @location(0) vec4f {
  var rgba = textureSample(tex, samp, v.uv);
  rgba.a *= u.opacity;
  return rgba;
}
`;

// Blit shader: copies a texture_2d into the render target (used to blit frameTex → canvas / readbackTex)
const WGSL_BLIT = /* wgsl */ `
struct VertexOut {
  @builtin(position) pos: vec4f,
  @location(0) uv: vec2f,
};

@group(0) @binding(0) var tex: texture_2d<f32>;
@group(0) @binding(1) var samp: sampler;

@vertex
fn vs(@builtin(vertex_index) vi: u32) -> VertexOut {
  var quads = array<vec2f, 4>(
    vec2f(0.0, 0.0), vec2f(1.0, 0.0),
    vec2f(0.0, 1.0), vec2f(1.0, 1.0),
  );
  let uv = quads[vi];
  let ndcX = uv.x * 2.0 - 1.0;
  let ndcY = 1.0 - uv.y * 2.0;
  return VertexOut(vec4f(ndcX, ndcY, 0.0, 1.0), uv);
}

@fragment
fn fs(v: VertexOut) -> @location(0) vec4f {
  return textureSample(tex, samp, v.uv);
}
`;

const ALPHA_BLEND: GPUBlendState = {
  color: { srcFactor: "src-alpha", dstFactor: "one-minus-src-alpha", operation: "add" },
  alpha: { srcFactor: "one", dstFactor: "one-minus-src-alpha", operation: "add" },
};

export type ReadPixelFn = (x: number, y: number) => Promise<[number, number, number, number]>;

export class FrameRenderer {
  private device: GPUDevice;
  private ctx: GPUCanvasContext;
  // layer composite pipelines (draw into offscreen frameTex with alpha blend)
  private extCompPipeline: GPURenderPipeline;
  private copyCompPipeline: GPURenderPipeline;
  // blit pipelines (copy frameTex → canvas or readbackTex, no blend)
  private blitCanvasPipeline: GPURenderPipeline;
  private blitReadbackPipeline: GPURenderPipeline;
  private sampler: GPUSampler;
  private readbackTex: GPUTexture;
  private canvasFmt: GPUTextureFormat;
  // bind group layouts
  private extBgl: GPUBindGroupLayout;
  private copyBgl: GPUBindGroupLayout;
  private blitBgl: GPUBindGroupLayout;
  // offscreen composite target (rgba8unorm, recreated on resize)
  private frameTex: GPUTexture;

  private constructor(
    device: GPUDevice,
    ctx: GPUCanvasContext,
    extCompPipeline: GPURenderPipeline,
    copyCompPipeline: GPURenderPipeline,
    blitCanvasPipeline: GPURenderPipeline,
    blitReadbackPipeline: GPURenderPipeline,
    sampler: GPUSampler,
    readbackTex: GPUTexture,
    canvasFmt: GPUTextureFormat,
    extBgl: GPUBindGroupLayout,
    copyBgl: GPUBindGroupLayout,
    blitBgl: GPUBindGroupLayout,
    frameTex: GPUTexture,
  ) {
    this.device = device;
    this.ctx = ctx;
    this.extCompPipeline = extCompPipeline;
    this.copyCompPipeline = copyCompPipeline;
    this.blitCanvasPipeline = blitCanvasPipeline;
    this.blitReadbackPipeline = blitReadbackPipeline;
    this.sampler = sampler;
    this.readbackTex = readbackTex;
    this.canvasFmt = canvasFmt;
    this.extBgl = extBgl;
    this.copyBgl = copyBgl;
    this.blitBgl = blitBgl;
    this.frameTex = frameTex;
  }

  static async create(canvas: HTMLCanvasElement | OffscreenCanvas): Promise<FrameRenderer> {
    if (!navigator.gpu) throw new Error("WebGPU not supported");
    let adapter = await navigator.gpu.requestAdapter({ powerPreference: "low-power" });
    if (!adapter) adapter = await navigator.gpu.requestAdapter({ forceFallbackAdapter: true });
    if (!adapter) throw new Error("No WebGPU adapter");
    const device = await adapter.requestDevice();

    const canvasFmt = navigator.gpu.getPreferredCanvasFormat();
    const ctx = canvas.getContext("webgpu") as GPUCanvasContext;
    ctx.configure({ device, format: canvasFmt, alphaMode: "opaque" });

    const extModule = device.createShaderModule({ code: WGSL_EXT });
    const texModule = device.createShaderModule({ code: WGSL_TEX });
    const blitModule = device.createShaderModule({ code: WGSL_BLIT });

    const extBgl = device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.FRAGMENT, externalTexture: {} },
        { binding: 1, visibility: GPUShaderStage.FRAGMENT, sampler: {} },
        { binding: 2, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: "uniform" } },
      ],
    });

    const copyBgl = device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: "float" } },
        { binding: 1, visibility: GPUShaderStage.FRAGMENT, sampler: {} },
        { binding: 2, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: "uniform" } },
      ],
    });

    const blitBgl = device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: "float" } },
        { binding: 1, visibility: GPUShaderStage.FRAGMENT, sampler: {} },
      ],
    });

    const extLayout = device.createPipelineLayout({ bindGroupLayouts: [extBgl] });
    const copyLayout = device.createPipelineLayout({ bindGroupLayouts: [copyBgl] });
    const blitLayout = device.createPipelineLayout({ bindGroupLayouts: [blitBgl] });

    // Layer composite pipelines: draw into rgba8unorm frameTex with alpha blending
    const extCompPipeline = device.createRenderPipeline({
      layout: extLayout,
      vertex: { module: extModule, entryPoint: "vs" },
      fragment: { module: extModule, entryPoint: "fs", targets: [{ format: "rgba8unorm", blend: ALPHA_BLEND }] },
      primitive: { topology: "triangle-strip" },
    });

    const copyCompPipeline = device.createRenderPipeline({
      layout: copyLayout,
      vertex: { module: texModule, entryPoint: "vs" },
      fragment: { module: texModule, entryPoint: "fs", targets: [{ format: "rgba8unorm", blend: ALPHA_BLEND }] },
      primitive: { topology: "triangle-strip" },
    });

    // Blit pipelines: copy frameTex (rgba8unorm, already composited) → canvas or readback
    const blitCanvasPipeline = device.createRenderPipeline({
      layout: blitLayout,
      vertex: { module: blitModule, entryPoint: "vs" },
      fragment: { module: blitModule, entryPoint: "fs", targets: [{ format: canvasFmt }] },
      primitive: { topology: "triangle-strip" },
    });

    const blitReadbackPipeline = device.createRenderPipeline({
      layout: blitLayout,
      vertex: { module: blitModule, entryPoint: "vs" },
      fragment: { module: blitModule, entryPoint: "fs", targets: [{ format: "rgba8unorm" }] },
      primitive: { topology: "triangle-strip" },
    });

    const sampler = device.createSampler({ minFilter: "linear", magFilter: "linear" });

    const cw = canvas.width;
    const ch = canvas.height;
    const readbackTex = device.createTexture({
      size: [cw, ch],
      format: "rgba8unorm",
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
    });

    const frameTex = device.createTexture({
      size: [cw, ch],
      format: "rgba8unorm",
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_SRC,
    });

    return new FrameRenderer(
      device, ctx,
      extCompPipeline, copyCompPipeline,
      blitCanvasPipeline, blitReadbackPipeline,
      sampler, readbackTex, canvasFmt,
      extBgl, copyBgl, blitBgl,
      frameTex,
    );
  }

  async composite(layers: CompositeLayer[], renderSize: Size): Promise<void> {
    const device = this.device;
    const rw = renderSize.width;
    const rh = renderSize.height;

    // Recreate frameTex if size changed
    if (this.frameTex.width !== rw || this.frameTex.height !== rh) {
      this.frameTex.destroy();
      this.frameTex = device.createTexture({
        size: [rw, rh],
        format: "rgba8unorm",
        usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_SRC,
      });
    }

    // Recreate readbackTex if size changed
    if (this.readbackTex.width !== rw || this.readbackTex.height !== rh) {
      this.readbackTex.destroy();
      this.readbackTex = device.createTexture({
        size: [rw, rh],
        format: "rgba8unorm",
        usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
      });
    }

    type LayerRecord =
      | { kind: "ext"; extTex: GPUExternalTexture; uBuf: GPUBuffer }
      | { kind: "copy"; copyTex: GPUTexture; uBuf: GPUBuffer };

    const perLayerTempTextures: GPUTexture[] = [];
    const perLayerUBufs: GPUBuffer[] = [];
    const records: LayerRecord[] = [];

    // Phase 1 (async, no encoder open): import or copy each layer's pixels
    try {
      for (const layer of layers) {
        const mat = layer.transform;
        const natW = layer.frame.displayWidth;
        const natH = layer.frame.displayHeight;
        const op = layer.opacity;
        const c = layer.crop;

        const uData = new Float32Array([
          mat.a, mat.b,
          mat.c, mat.d,
          mat.e, mat.f,
          natW, natH,
          rw, rh,
          op,
          c.left, c.top, c.right, c.bottom,
          0, // _pad
        ]);
        const uBuf = device.createBuffer({
          size: UNIFORMS_F32 * 4,
          usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        });
        device.queue.writeBuffer(uBuf, 0, uData);
        perLayerUBufs.push(uBuf);

        let extTex: GPUExternalTexture | null = null;
        try {
          extTex = device.importExternalTexture({ source: layer.frame });
        } catch {
          // software path below
        }

        if (extTex !== null) {
          records.push({ kind: "ext", extTex, uBuf });
        } else {
          const unpadded = natW * 4;
          const bytesPerRow = Math.ceil(unpadded / 256) * 256;
          const pixelBuf = new Uint8Array(bytesPerRow * natH);
          await layer.frame.copyTo(pixelBuf, { format: "RGBA", layout: [{ offset: 0, stride: bytesPerRow }] });

          const copyTex = device.createTexture({
            size: [natW, natH],
            format: "rgba8unorm",
            usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
          });
          perLayerTempTextures.push(copyTex);

          device.queue.writeTexture(
            { texture: copyTex },
            pixelBuf,
            { bytesPerRow },
            [natW, natH],
          );

          records.push({ kind: "copy", copyTex, uBuf });
        }
      }

      // Phase 2 (synchronous): one encoder, three passes, one submit
      const frameTexView = this.frameTex.createView();
      const encoder = device.createCommandEncoder();

      // Composite pass: draw all layers into frameTex
      const compPass = encoder.beginRenderPass({
        colorAttachments: [{
          view: frameTexView,
          clearValue: { r: 0, g: 0, b: 0, a: 0 },
          loadOp: "clear",
          storeOp: "store",
        }],
      });
      for (const rec of records) {
        if (rec.kind === "ext") {
          const bg = device.createBindGroup({
            layout: this.extBgl,
            entries: [
              { binding: 0, resource: rec.extTex },
              { binding: 1, resource: this.sampler },
              { binding: 2, resource: { buffer: rec.uBuf } },
            ],
          });
          compPass.setPipeline(this.extCompPipeline);
          compPass.setBindGroup(0, bg);
          compPass.draw(4);
        } else {
          const bg = device.createBindGroup({
            layout: this.copyBgl,
            entries: [
              { binding: 0, resource: rec.copyTex.createView() },
              { binding: 1, resource: this.sampler },
              { binding: 2, resource: { buffer: rec.uBuf } },
            ],
          });
          compPass.setPipeline(this.copyCompPipeline);
          compPass.setBindGroup(0, bg);
          compPass.draw(4);
        }
      }
      compPass.end();

      // Blit frameTex → canvas
      const blitBg = device.createBindGroup({
        layout: this.blitBgl,
        entries: [
          { binding: 0, resource: frameTexView },
          { binding: 1, resource: this.sampler },
        ],
      });
      const canvasPass = encoder.beginRenderPass({
        colorAttachments: [{
          view: this.ctx.getCurrentTexture().createView(),
          clearValue: { r: 0, g: 0, b: 0, a: 1 },
          loadOp: "clear",
          storeOp: "store",
        }],
      });
      canvasPass.setPipeline(this.blitCanvasPipeline);
      canvasPass.setBindGroup(0, blitBg);
      canvasPass.draw(4);
      canvasPass.end();

      // Blit frameTex → readbackTex
      const rbPass = encoder.beginRenderPass({
        colorAttachments: [{
          view: this.readbackTex.createView(),
          clearValue: { r: 0, g: 0, b: 0, a: 1 },
          loadOp: "clear",
          storeOp: "store",
        }],
      });
      rbPass.setPipeline(this.blitReadbackPipeline);
      rbPass.setBindGroup(0, blitBg);
      rbPass.draw(4);
      rbPass.end();

      device.queue.submit([encoder.finish()]);
    } finally {
      for (const t of perLayerTempTextures) t.destroy();
      for (const b of perLayerUBufs) b.destroy();
    }
  }

  async present(frame: VideoFrame, mat: Mat2d, renderSize: Size): Promise<void> {
    return this.composite(
      [{ frame, transform: mat, opacity: 1, crop: { left: 0, top: 0, right: 0, bottom: 0 } }],
      renderSize,
    );
  }

  // WARNING: sustained calls in an Electron loop destabilise the GPU device (device-lost). Use VideoFrame.copyTo instead — see FfmpegIpcSink.pushFrame in apps/desktop/src/renderer/ffmpeg-sink.ts.
  async readRGBA(): Promise<Uint8Array> {
    const device = this.device;
    const w = this.readbackTex.width;
    const h = this.readbackTex.height;
    const unpadded = w * 4;
    const bytesPerRow = Math.ceil(unpadded / 256) * 256;
    const buf = device.createBuffer({
      size: bytesPerRow * h,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    });
    const enc = device.createCommandEncoder();
    enc.copyTextureToBuffer(
      { texture: this.readbackTex, origin: { x: 0, y: 0, z: 0 } },
      { buffer: buf, bytesPerRow },
      [w, h],
    );
    device.queue.submit([enc.finish()]);
    await buf.mapAsync(GPUMapMode.READ);
    const raw = new Uint8Array(buf.getMappedRange());
    // Strip 256-aligned row padding → tight w*h*4 RGBA
    const tight = new Uint8Array(w * h * 4);
    for (let row = 0; row < h; row++) {
      tight.set(raw.subarray(row * bytesPerRow, row * bytesPerRow + unpadded), row * unpadded);
    }
    buf.unmap();
    buf.destroy();
    return tight;
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
    if (typeof HTMLCanvasElement === "undefined" || !(this.ctx.canvas instanceof HTMLCanvasElement)) {
      // resize() is for the live preview canvas only; offscreen export renderers are fixed-size
      return;
    }
    const canvas = this.ctx.canvas;
    canvas.width = w;
    canvas.height = h;
    this.readbackTex.destroy();
    this.readbackTex = this.device.createTexture({
      size: [w, h],
      format: "rgba8unorm",
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
    });
    this.frameTex.destroy();
    this.frameTex = this.device.createTexture({
      size: [w, h],
      format: "rgba8unorm",
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_SRC,
    });
    this.ctx.configure({ device: this.device, format: this.canvasFmt, alphaMode: "opaque" });
  }

  dispose(): void {
    this.frameTex.destroy();
    this.readbackTex.destroy();
    this.device.destroy();
  }
}

export function readPixelFactory(renderer: FrameRenderer): ReadPixelFn {
  return (x, y) => renderer.readPixel(x, y);
}
