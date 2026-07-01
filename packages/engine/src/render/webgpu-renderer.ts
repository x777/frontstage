import type { Mat2d, Size, Effect, BlendMode, CubeLUT } from "@palmier/core";
import { canonicalSort, resolveParam, parseGradeCurve, evalCurve, parseHueCurves, evalHueCurve, BLEND_MODES } from "@palmier/core";
import type { GradeCurve, HueCurves } from "@palmier/core";
import type { CompositeLayer } from "./composite-layer.js";

// Uniforms layout (all f32, 64 bytes / 16 floats):
//   a, b, c, d, e, f        — affine matrix
//   natW, natH              — natural frame size
//   canvasW, canvasH        — render target size
//   opacity                 — per-layer opacity [0,1]
//   cropL, cropT, cropR, cropB — crop fractions [0,1)
//   _pad                    — alignment pad (total 16 × f32 = 64 bytes)
const UNIFORMS_F32 = 16;

// Per-layer effect intermediates are rgba16float for precision through an effect chain.
const FX_FORMAT: GPUTextureFormat = "rgba16float";

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

// Blit shader: copies a texture_2d into the render target (used to blit the accumulator → canvas / readbackTex)
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

// Full-screen-quad vertex shader shared by every effect/composite pass (matches WGSL_BLIT's uv↔ndc convention).
const WGSL_FULLSCREEN_VS = /* wgsl */ `
struct VertexOut {
  @builtin(position) pos: vec4f,
  @location(0) uv: vec2f,
};

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
`;

// Shared helpers used by the 6 scalar color effects.
const WGSL_COLOR_PRELUDE = /* wgsl */ `
fn srgbToLin(x: f32) -> f32 {
  return select(pow((x + 0.055) / 1.055, 2.4), x / 12.92, x <= 0.04045);
}
fn linToSrgb(x: f32) -> f32 {
  return select(1.055 * pow(x, 1.0 / 2.4) - 0.055, x * 12.92, x <= 0.0031308);
}
fn rec709(c: vec3f) -> f32 {
  return dot(c, vec3f(0.2126, 0.7152, 0.0722));
}
fn rgb2hsv(c: vec3f) -> vec3f {
  let cmax = max(c.r, max(c.g, c.b));
  let cmin = min(c.r, min(c.g, c.b));
  let d = cmax - cmin;
  var h = 0.0;
  if (d > 1e-9) {
    if (cmax == c.r) { h = ((c.g - c.b) / d) % 6.0; }
    else if (cmax == c.g) { h = (c.b - c.r) / d + 2.0; }
    else { h = (c.r - c.g) / d + 4.0; }
    h = h / 6.0;
    if (h < 0.0) { h = h + 1.0; }
  }
  let s = select(0.0, d / cmax, cmax > 0.0);
  return vec3f(h, s, cmax);
}
fn hsv2rgb(c: vec3f) -> vec3f {
  let h = fract(c.x);
  let i = floor(h * 6.0);
  let f = h * 6.0 - i;
  let p = c.z * (1.0 - c.y);
  let q = c.z * (1.0 - f * c.y);
  let t = c.z * (1.0 - (1.0 - f) * c.y);
  let ii = i32(i) % 6;
  if (ii == 0) { return vec3f(c.z, t, p); }
  if (ii == 1) { return vec3f(q, c.z, p); }
  if (ii == 2) { return vec3f(p, c.z, t); }
  if (ii == 3) { return vec3f(p, q, c.z); }
  if (ii == 4) { return vec3f(t, p, c.z); }
  return vec3f(c.z, p, q);
}
`;

// Effect: color.saturation — WGSL port of core applySaturation (y + (rgb-y)*amount; amount=0 → grey).
const WGSL_SAT = WGSL_FULLSCREEN_VS + /* wgsl */ `
struct Sat { amount: f32 };

@group(0) @binding(0) var src: texture_2d<f32>;
@group(0) @binding(1) var samp: sampler;
@group(0) @binding(2) var<uniform> u: Sat;

@fragment
fn fs(@location(0) uv: vec2f) -> @location(0) vec4f {
  var c = textureSample(src, samp, uv);
  let y = dot(c.rgb, vec3f(0.2126, 0.7152, 0.0722));
  c = vec4f(vec3f(y) + (c.rgb - vec3f(y)) * u.amount, c.a);
  return c;
}
`;

// Effect: color.exposure — linear exposure via sRGB↔linear roundtrip.
const WGSL_EXPOSURE = WGSL_COLOR_PRELUDE + WGSL_FULLSCREEN_VS + /* wgsl */ `
struct Exp { ev: f32 };

@group(0) @binding(0) var src: texture_2d<f32>;
@group(0) @binding(1) var samp: sampler;
@group(0) @binding(2) var<uniform> u: Exp;

@fragment
fn fs(@location(0) uv: vec2f) -> @location(0) vec4f {
  var c = textureSample(src, samp, uv);
  let k = pow(2.0, u.ev);
  c = vec4f(linToSrgb(srgbToLin(c.r) * k), linToSrgb(srgbToLin(c.g) * k), linToSrgb(srgbToLin(c.b) * k), c.a);
  return c;
}
`;

// Effect: color.contrast — pivot at 0.5.
const WGSL_CONTRAST = WGSL_COLOR_PRELUDE + WGSL_FULLSCREEN_VS + /* wgsl */ `
struct Con { amount: f32 };

@group(0) @binding(0) var src: texture_2d<f32>;
@group(0) @binding(1) var samp: sampler;
@group(0) @binding(2) var<uniform> u: Con;

@fragment
fn fs(@location(0) uv: vec2f) -> @location(0) vec4f {
  var c = textureSample(src, samp, uv);
  c = vec4f((c.rgb - vec3f(0.5)) * u.amount + vec3f(0.5), c.a);
  return c;
}
`;

// Effect: color.highlightsShadows — smoothstep masks for hi/lo adjustment.
const WGSL_HS = WGSL_COLOR_PRELUDE + WGSL_FULLSCREEN_VS + /* wgsl */ `
struct HS { highlights: f32, shadows: f32 };

@group(0) @binding(0) var src: texture_2d<f32>;
@group(0) @binding(1) var samp: sampler;
@group(0) @binding(2) var<uniform> u: HS;

fn hsAdj(x: f32, hi: f32, sh: f32) -> f32 {
  let shadowMask = 1.0 - smoothstep(0.0, 0.5, x);
  let hiMask = smoothstep(0.5, 1.0, x);
  return clamp(x + sh * 0.5 * shadowMask + hi * 0.5 * hiMask, 0.0, 1.0);
}

@fragment
fn fs(@location(0) uv: vec2f) -> @location(0) vec4f {
  var c = textureSample(src, samp, uv);
  c = vec4f(hsAdj(c.r, u.highlights, u.shadows), hsAdj(c.g, u.highlights, u.shadows), hsAdj(c.b, u.highlights, u.shadows), c.a);
  return c;
}
`;

// Effect: color.blacksWhites — remap [blacks*0.25, 1+whites*0.25] → [0,1].
const WGSL_BW = WGSL_COLOR_PRELUDE + WGSL_FULLSCREEN_VS + /* wgsl */ `
struct BW { blacks: f32, whites: f32 };

@group(0) @binding(0) var src: texture_2d<f32>;
@group(0) @binding(1) var samp: sampler;
@group(0) @binding(2) var<uniform> u: BW;

@fragment
fn fs(@location(0) uv: vec2f) -> @location(0) vec4f {
  var c = textureSample(src, samp, uv);
  let lo = u.blacks * 0.25;
  let hi = 1.0 + u.whites * 0.25;
  let bwd = max(1e-3, hi - lo);
  c = vec4f(clamp((c.rgb - vec3f(lo)) / vec3f(bwd), vec3f(0.0), vec3f(1.0)), c.a);
  return c;
}
`;

// Effect: color.temperature — per-channel scale from colour temperature + tint.
const WGSL_TEMP = WGSL_COLOR_PRELUDE + WGSL_FULLSCREEN_VS + /* wgsl */ `
struct Tmp { temperature: f32, tint: f32 };

@group(0) @binding(0) var src: texture_2d<f32>;
@group(0) @binding(1) var samp: sampler;
@group(0) @binding(2) var<uniform> u: Tmp;

@fragment
fn fs(@location(0) uv: vec2f) -> @location(0) vec4f {
  var c = textureSample(src, samp, uv);
  let tt = (u.temperature - 6500.0) / 4500.0;
  let scale = vec3f(1.0 + tt * 0.2, 1.0 - (u.tint / 100.0) * 0.2, 1.0 - tt * 0.2);
  c = vec4f(clamp(c.rgb * scale, vec3f(0.0), vec3f(1.0)), c.a);
  return c;
}
`;

// Effect: color.vibrance — saturation boost proportional to (1 - existing saturation).
const WGSL_VIB = WGSL_COLOR_PRELUDE + WGSL_FULLSCREEN_VS + /* wgsl */ `
struct Vib { amount: f32 };

@group(0) @binding(0) var src: texture_2d<f32>;
@group(0) @binding(1) var samp: sampler;
@group(0) @binding(2) var<uniform> u: Vib;

@fragment
fn fs(@location(0) uv: vec2f) -> @location(0) vec4f {
  var c = textureSample(src, samp, uv);
  let hsv = rgb2hsv(c.rgb);
  let boost = u.amount * (1.0 - hsv.y);
  let y = rec709(c.rgb);
  c = vec4f(vec3f(y) + (c.rgb - vec3f(y)) * (1.0 + boost), c.a);
  return c;
}
`;

// Effect: color.wheels — lift/gamma/gain per channel with optional chroma offset on each wheel.
const WGSL_WHEELS = WGSL_COLOR_PRELUDE + WGSL_FULLSCREEN_VS + /* wgsl */ `
struct Wheels { lift: vec4f, gamma: vec4f, gain: vec4f };

@group(0) @binding(0) var src: texture_2d<f32>;
@group(0) @binding(1) var samp: sampler;
@group(0) @binding(2) var<uniform> u: Wheels;

fn chromaOffset(x: f32, y: f32) -> vec3f {
  let r = min(1.0, sqrt(x * x + y * y));
  if (r <= 1e-6) { return vec3f(0.0); }
  var hue = atan2(y, x) / (2.0 * 3.14159265359); hue = fract(hue);
  let rgb = hsv2rgb(vec3f(hue, r, 1.0));
  let m = (rgb.r + rgb.g + rgb.b) / 3.0;
  return rgb - vec3f(m);
}

fn wheelCh(inp: f32, lo: f32, go: f32, ga: f32, liftM: f32, gammaM: f32, gainM: f32) -> f32 {
  let liftC = liftM + lo * 0.2;
  let gainC = gainM * (1.0 + ga * 0.35);
  let invGamma = 1.0 / max(0.01, gammaM * (1.0 + go * 0.35));
  return clamp(pow(max(0.0, inp * (1.0 - liftC) + liftC) * gainC, invGamma), 0.0, 1.0);
}

@fragment
fn fs(@location(0) uv: vec2f) -> @location(0) vec4f {
  var c = textureSample(src, samp, uv);
  let lo = chromaOffset(u.lift.x, u.lift.y);
  let go = chromaOffset(u.gamma.x, u.gamma.y);
  let ga = chromaOffset(u.gain.x, u.gain.y);
  c = vec4f(
    wheelCh(c.r, lo.r, go.r, ga.r, u.lift.z, u.gamma.z, u.gain.z),
    wheelCh(c.g, lo.g, go.g, ga.g, u.lift.z, u.gamma.z, u.gain.z),
    wheelCh(c.b, lo.b, go.b, ga.b, u.lift.z, u.gamma.z, u.gain.z),
    c.a);
  return c;
}
`;

// Effect: color.curves — CPU-baked 256×1 RGBA LUT; luma-proportional master rescale then per-channel.
const WGSL_CURVES = WGSL_COLOR_PRELUDE + WGSL_FULLSCREEN_VS + /* wgsl */ `
@group(0) @binding(0) var src: texture_2d<f32>;
@group(0) @binding(1) var samp: sampler;
@group(0) @binding(2) var lut: texture_2d<f32>;
@group(0) @binding(3) var lutSamp: sampler;

@fragment
fn fs(@location(0) uv: vec2f) -> @location(0) vec4f {
  var c = textureSample(src, samp, uv);
  let yv = rec709(c.rgb);
  let m = textureSampleLevel(lut, lutSamp, vec2f((yv * 255.0 + 0.5) / 256.0, 0.5), 0.0);
  var rgb = c.rgb;
  if (yv > 1e-4) { rgb = rgb * min(m.r / yv, 8.0); } else { rgb = vec3f(m.r); }
  rgb.r = textureSampleLevel(lut, lutSamp, vec2f((rgb.r * 255.0 + 0.5) / 256.0, 0.5), 0.0).g;
  rgb.g = textureSampleLevel(lut, lutSamp, vec2f((rgb.g * 255.0 + 0.5) / 256.0, 0.5), 0.0).b;
  rgb.b = textureSampleLevel(lut, lutSamp, vec2f((rgb.b * 255.0 + 0.5) / 256.0, 0.5), 0.0).a;
  return vec4f(rgb, c.a);
}
`;

// Effect: color.hueCurves — CPU-baked 256×1 RGB LUT indexed by hue; satScale multiplicative, sat-gate.
const WGSL_HUE_CURVES = WGSL_COLOR_PRELUDE + WGSL_FULLSCREEN_VS + /* wgsl */ `
@group(0) @binding(0) var src: texture_2d<f32>;
@group(0) @binding(1) var samp: sampler;
@group(0) @binding(2) var lut: texture_2d<f32>;
@group(0) @binding(3) var lutSamp: sampler;

@fragment
fn fs(@location(0) uv: vec2f) -> @location(0) vec4f {
  var c = textureSample(src, samp, uv);
  let hsv = rgb2hsv(c.rgb);
  let L = textureSampleLevel(lut, lutSamp, vec2f((hsv.x * 255.0 + 0.5) / 256.0, 0.5), 0.0);
  let dHue = (L.r - 0.5) * 2.0 * (1.0 / 12.0);
  let satScale = (L.g - 0.5) * 2.0;
  let dLum = (L.b - 0.5) * 2.0 * 0.5;
  let gate = smoothstep(0.04, 0.18, hsv.y);
  return vec4f(hsv2rgb(vec3f(fract(hsv.x + dHue * gate), clamp(hsv.y * (1.0 + satScale * gate), 0.0, 1.0), clamp(hsv.z + dLum * gate, 0.0, 1.0))), c.a);
}
`;

// Effect: color.lut — 3D-texture tetrahedral sampler, exact port of sampleLUT + combine from lut.ts.
const WGSL_LUT = WGSL_FULLSCREEN_VS + /* wgsl */ `
struct Lut { intensity: f32, dim: f32, _pad0: f32, _pad1: f32 };

@group(0) @binding(0) var src: texture_2d<f32>;
@group(0) @binding(1) var samp: sampler;
@group(0) @binding(2) var lut3d: texture_3d<f32>;
@group(0) @binding(3) var<uniform> u: Lut;

fn lutCombine(c0: vec3f, cA: vec3f, cB: vec3f, c1: vec3f, w0: f32, w1: f32, w2: f32) -> vec3f {
  return c0 * (1.0 - w0) + cA * (w0 - w1) + cB * (w1 - w2) + c1 * w2;
}

fn lutNode(r: i32, g: i32, b: i32) -> vec3f {
  return textureLoad(lut3d, vec3i(r, g, b), 0).rgb;
}

fn tetra(p: vec3f, n: i32) -> vec3f {
  let r0 = i32(floor(p.x));
  let g0 = i32(floor(p.y));
  let b0 = i32(floor(p.z));
  let r1 = min(r0 + 1, n - 1);
  let g1 = min(g0 + 1, n - 1);
  let b1 = min(b0 + 1, n - 1);
  let fr = p.x - f32(r0);
  let fg = p.y - f32(g0);
  let fb = p.z - f32(b0);
  let c000 = lutNode(r0, g0, b0);
  let c111 = lutNode(r1, g1, b1);
  if (fr >= fg && fg >= fb) {
    return lutCombine(c000, lutNode(r1, g0, b0), lutNode(r1, g1, b0), c111, fr, fg, fb);
  } else if (fr >= fb && fb >= fg) {
    return lutCombine(c000, lutNode(r1, g0, b0), lutNode(r1, g0, b1), c111, fr, fb, fg);
  } else if (fb >= fr && fr >= fg) {
    return lutCombine(c000, lutNode(r0, g0, b1), lutNode(r1, g0, b1), c111, fb, fr, fg);
  } else if (fg >= fr && fr >= fb) {
    return lutCombine(c000, lutNode(r0, g1, b0), lutNode(r1, g1, b0), c111, fg, fr, fb);
  } else if (fg >= fb && fb >= fr) {
    return lutCombine(c000, lutNode(r0, g1, b0), lutNode(r0, g1, b1), c111, fg, fb, fr);
  }
  return lutCombine(c000, lutNode(r0, g0, b1), lutNode(r0, g1, b1), c111, fb, fg, fr);
}

@fragment
fn fs(@location(0) uv: vec2f) -> @location(0) vec4f {
  var c = textureSample(src, samp, uv);
  let n = i32(u.dim);
  let p = clamp(c.rgb, vec3f(0.0), vec3f(1.0)) * (f32(n) - 1.0);
  let sampled = tetra(p, n);
  return vec4f(mix(c.rgb, sampled, u.intensity), c.a);
}
`;

// Effect: key.chroma — mirrors applyChromaKey from color-math.ts exactly.
const WGSL_CHROMA = WGSL_COLOR_PRELUDE + WGSL_FULLSCREEN_VS + /* wgsl */ `
struct Chroma { keyHue: f32, tolerance: f32, softness: f32, spill: f32 };

@group(0) @binding(0) var src: texture_2d<f32>;
@group(0) @binding(1) var samp: sampler;
@group(0) @binding(2) var<uniform> u: Chroma;

@fragment
fn fs(@location(0) uv: vec2f) -> @location(0) vec4f {
  var c = textureSample(src, samp, uv);
  let hsv = rgb2hsv(c.rgb);
  let diff = abs(hsv.x - u.keyHue);
  let hd = min(diff, 1.0 - diff);
  let inner = u.tolerance * 0.25;
  let key = (1.0 - smoothstep(inner, inner + u.softness * 0.3 + 0.02, hd)) * smoothstep(0.12, 0.32, hsv.y);
  let yGrey = rec709(c.rgb);
  let m = u.spill * key;
  c = vec4f(c.rgb * (1.0 - m) + vec3f(yGrey) * m, c.a * (1.0 - key));
  return c;
}
`;

// Effect: stylize.vignette — standard radial falloff.
const WGSL_VIGNETTE = WGSL_FULLSCREEN_VS + /* wgsl */ `
struct Vignette { amount: f32, midpoint: f32, roundness: f32, feather: f32 };

@group(0) @binding(0) var src: texture_2d<f32>;
@group(0) @binding(1) var samp: sampler;
@group(0) @binding(2) var<uniform> u: Vignette;

@fragment
fn fs(@location(0) uv: vec2f) -> @location(0) vec4f {
  var c = textureSample(src, samp, uv);
  let p = (uv - vec2f(0.5)) * 2.0;
  let rr = mix(max(abs(p.x), abs(p.y)), length(p), (u.roundness + 1.0) * 0.5);
  let falloff = 1.0 - smoothstep(u.midpoint, u.midpoint + u.feather + 0.001, rr);
  let vig = 1.0 + u.amount * (1.0 - falloff);
  c = vec4f(clamp(c.rgb * vig, vec3f(0.0), vec3f(1.0)), c.a);
  return c;
}
`;

// Effect: stylize.grain — deterministic hash noise; resX/resY are the canvas dimensions.
const WGSL_GRAIN = WGSL_FULLSCREEN_VS + /* wgsl */ `
struct Grain { amount: f32, size: f32, resX: f32, resY: f32 };

@group(0) @binding(0) var src: texture_2d<f32>;
@group(0) @binding(1) var samp: sampler;
@group(0) @binding(2) var<uniform> u: Grain;

fn hash21(p: vec2f) -> f32 { return fract(sin(dot(p, vec2f(12.9898, 78.233))) * 43758.5453); }

@fragment
fn fs(@location(0) uv: vec2f) -> @location(0) vec4f {
  var c = textureSample(src, samp, uv);
  let cell = floor(uv * vec2f(u.resX, u.resY) / max(0.5, u.size));
  let g = hash21(cell) - 0.5;
  c = vec4f(clamp(c.rgb + vec3f(g * u.amount), vec3f(0.0), vec3f(1.0)), c.a);
  return c;
}
`;

// Effect: blur.gaussian — separable 2-pass gaussian; uniform: {dir: vec2f, radius: f32, _pad: f32}.
const WGSL_GAUSS = WGSL_FULLSCREEN_VS + /* wgsl */ `
struct GaussU { dir: vec2f, radius: f32, _pad: f32 };

@group(0) @binding(0) var src: texture_2d<f32>;
@group(0) @binding(1) var samp: sampler;
@group(0) @binding(2) var<uniform> u: GaussU;

@fragment
fn fs(@location(0) uv: vec2f) -> @location(0) vec4f {
  var sum = vec4f(0.0); var wsum = 0.0;
  let sigma = max(0.5, u.radius * 0.5);
  let taps = i32(min(24.0, ceil(sigma * 3.0)));
  for (var i = -taps; i <= taps; i = i + 1) {
    let w = exp(-f32(i * i) / (2.0 * sigma * sigma));
    sum = sum + textureSample(src, samp, uv + u.dir * f32(i)) * w;
    wsum = wsum + w;
  }
  return sum / wsum;
}
`;

// Effect: blur.motion — single directional-blur pass; uniform {angle(deg), radius, resX, resY}.
const WGSL_MOTION = WGSL_FULLSCREEN_VS + /* wgsl */ `
struct MotionU { angle: f32, radius: f32, resX: f32, resY: f32 };

@group(0) @binding(0) var src: texture_2d<f32>;
@group(0) @binding(1) var samp: sampler;
@group(0) @binding(2) var<uniform> u: MotionU;

@fragment
fn fs(@location(0) uv: vec2f) -> @location(0) vec4f {
  let taps = i32(min(32.0, max(1.0, u.radius)));
  let dir = vec2f(cos(radians(u.angle)), sin(radians(u.angle))) / vec2f(u.resX, u.resY);
  var sum = vec4f(0.0);
  for (var i = -taps; i <= taps; i = i + 1) {
    sum = sum + textureSample(src, samp, uv + dir * f32(i));
  }
  return sum / f32(2 * taps + 1);
}
`;

// fx2 combine for blur.sharpen (unsharp mask): texA=blurred, texB=orig, uniform {amount}.
const WGSL_SHARPEN_FX2 = WGSL_FULLSCREEN_VS + /* wgsl */ `
struct SharpenU { amount: f32 };

@group(0) @binding(0) var texA: texture_2d<f32>;
@group(0) @binding(1) var texB: texture_2d<f32>;
@group(0) @binding(2) var samp: sampler;
@group(0) @binding(3) var<uniform> u: SharpenU;

@fragment
fn fs(@location(0) uv: vec2f) -> @location(0) vec4f {
  let blur = textureSample(texA, samp, uv);
  let orig = textureSample(texB, samp, uv);
  return vec4f(clamp(orig.rgb + (orig.rgb - blur.rgb) * u.amount, vec3f(0.0), vec3f(1.0)), orig.a);
}
`;

// fx2 mix for blur.noiseReduction: texA=blurred, texB=orig, uniform {amount}. amount=0→passthrough.
const WGSL_NOISE_RED_FX2 = WGSL_FULLSCREEN_VS + /* wgsl */ `
struct NrU { amount: f32 };

@group(0) @binding(0) var texA: texture_2d<f32>;
@group(0) @binding(1) var texB: texture_2d<f32>;
@group(0) @binding(2) var samp: sampler;
@group(0) @binding(3) var<uniform> u: NrU;

@fragment
fn fs(@location(0) uv: vec2f) -> @location(0) vec4f {
  let blur = textureSample(texA, samp, uv);
  let orig = textureSample(texB, samp, uv);
  return vec4f(mix(orig.rgb, blur.rgb, u.amount), orig.a);
}
`;

// fx2 combine for detail.clarity (large-radius local contrast + dehaze): texA=localAvg, texB=orig.
const WGSL_CLARITY_FX2 = WGSL_FULLSCREEN_VS + /* wgsl */ `
struct ClarityU { clarity: f32, dehaze: f32 };

@group(0) @binding(0) var texA: texture_2d<f32>;
@group(0) @binding(1) var texB: texture_2d<f32>;
@group(0) @binding(2) var samp: sampler;
@group(0) @binding(3) var<uniform> u: ClarityU;

@fragment
fn fs(@location(0) uv: vec2f) -> @location(0) vec4f {
  let avg = textureSample(texA, samp, uv);
  let orig = textureSample(texB, samp, uv);
  var rgb = orig.rgb + (orig.rgb - avg.rgb) * u.clarity;
  rgb = (rgb - vec3f(0.5)) * (1.0 + u.dehaze * 0.5) + vec3f(0.5);
  return vec4f(clamp(rgb, vec3f(0.0), vec3f(1.0)), orig.a);
}
`;

// Threshold-extract bright pixels for stylize.glow; uniform {threshold}.
const WGSL_GLOW_THRESH = WGSL_FULLSCREEN_VS + /* wgsl */ `
struct GlowThreshU { threshold: f32 };

@group(0) @binding(0) var src: texture_2d<f32>;
@group(0) @binding(1) var samp: sampler;
@group(0) @binding(2) var<uniform> u: GlowThreshU;

@fragment
fn fs(@location(0) uv: vec2f) -> @location(0) vec4f {
  var c = textureSample(src, samp, uv);
  let b = max(vec3f(0.0), c.rgb - vec3f(u.threshold)) / max(0.001, 1.0 - u.threshold);
  return vec4f(b, c.a);
}
`;

// fx2 add for stylize.glow: texA=blurred-bright, texB=orig, uniform {intensity, warmth}. intensity=0→passthrough.
const WGSL_GLOW_FX2 = WGSL_FULLSCREEN_VS + /* wgsl */ `
struct GlowFx2U { intensity: f32, warmth: f32 };

@group(0) @binding(0) var texA: texture_2d<f32>;
@group(0) @binding(1) var texB: texture_2d<f32>;
@group(0) @binding(2) var samp: sampler;
@group(0) @binding(3) var<uniform> u: GlowFx2U;

@fragment
fn fs(@location(0) uv: vec2f) -> @location(0) vec4f {
  let glow = textureSample(texA, samp, uv).rgb;
  let orig = textureSample(texB, samp, uv);
  let warm = mix(glow, glow * vec3f(1.1, 1.0, 0.85), u.warmth);
  return vec4f(clamp(orig.rgb + warm * u.intensity, vec3f(0.0), vec3f(1.0)), orig.a);
}
`;

// Normal-blend composite of an effected layer into the accumulator (opacity applied via alpha, ALPHA_BLEND state).
const WGSL_COMPOSITE = WGSL_FULLSCREEN_VS + /* wgsl */ `
struct Comp { opacity: f32 };

@group(0) @binding(0) var src: texture_2d<f32>;
@group(0) @binding(1) var samp: sampler;
@group(0) @binding(2) var<uniform> u: Comp;

@fragment
fn fs(@location(0) uv: vec2f) -> @location(0) vec4f {
  var c = textureSample(src, samp, uv);
  c.a = c.a * u.opacity;
  return c;
}
`;

// Blend shader: full-screen advanced blend pass. src=fxPing, dst=curAccum → otherAccum (no GPU blending; shader computes the full composite).
const WGSL_BLEND = WGSL_FULLSCREEN_VS + /* wgsl */ `
struct BlendU { mode: u32, opacity: f32 };
@group(0) @binding(0) var srcTex: texture_2d<f32>;
@group(0) @binding(1) var samp: sampler;
@group(0) @binding(2) var dstTex: texture_2d<f32>;
@group(0) @binding(3) var<uniform> u: BlendU;

fn sep1(mode: u32, s: f32, d: f32) -> f32 {
  switch mode {
    case 1u: { return min(s, d); }
    case 2u: { return s * d; }
    case 3u: { if (d <= 0.0) { return 0.0; } if (s <= 0.0) { return 0.0; } return 1.0 - min(1.0, (1.0 - d) / s); }
    case 4u: { return max(s, d); }
    case 5u: { return s + d - s * d; }
    case 6u: { if (d <= 0.0) { return 0.0; } if (s >= 1.0) { return 1.0; } return min(1.0, d / (1.0 - s)); }
    case 7u: { if (d <= 0.5) { return s * (2.0 * d); } return 1.0 - (1.0 - s) * (1.0 - 2.0 * (d - 0.5)); }
    case 8u: { if (s <= 0.5) { return d - (1.0 - 2.0 * s) * d * (1.0 - d); } var dd = sqrt(d); if (d <= 0.25) { dd = ((16.0 * d - 12.0) * d + 4.0) * d; } return d + (2.0 * s - 1.0) * (dd - d); }
    case 9u: { if (s <= 0.5) { return d * (2.0 * s); } return 1.0 - (1.0 - d) * (1.0 - 2.0 * (s - 0.5)); }
    case 10u: { return abs(s - d); }
    case 11u: { return s + d - 2.0 * s * d; }
    default: { return s; }
  }
}
fn bLum(c: vec3f) -> f32 { return 0.3 * c.r + 0.59 * c.g + 0.11 * c.b; }
fn clipColor(c: vec3f) -> vec3f {
  let l = bLum(c); let n = min(c.r, min(c.g, c.b)); let x = max(c.r, max(c.g, c.b));
  var r = c;
  if (n < 0.0) { r = l + (c - vec3f(l)) * l / (l - n); }
  if (x > 1.0) { r = l + (r - vec3f(l)) * (1.0 - l) / (x - l); }
  return r;
}
fn setLum(c: vec3f, l: f32) -> vec3f { return clipColor(c + vec3f(l - bLum(c))); }
fn bSat(c: vec3f) -> f32 { return max(c.r, max(c.g, c.b)) - min(c.r, min(c.g, c.b)); }
fn setSat(c: vec3f, s: f32) -> vec3f {
  let mn = min(c.r, min(c.g, c.b)); let mx = max(c.r, max(c.g, c.b)); let md = c.r + c.g + c.b - mn - mx;
  var newMid = 0.0; var newMax = 0.0;
  if (mx > mn) { newMid = (md - mn) * s / (mx - mn); newMax = s; }
  var o = vec3f(0.0);
  if (c.r == mx) { o.r = newMax; } else if (c.r == mn) { o.r = 0.0; } else { o.r = newMid; }
  if (c.g == mx) { o.g = newMax; } else if (c.g == mn) { o.g = 0.0; } else { o.g = newMid; }
  if (c.b == mx) { o.b = newMax; } else if (c.b == mn) { o.b = 0.0; } else { o.b = newMid; }
  return o;
}
fn hslBlend(mode: u32, s: vec3f, d: vec3f) -> vec3f {
  switch mode {
    case 12u: { return setLum(setSat(s, bSat(d)), bLum(d)); }
    case 13u: { return setLum(setSat(d, bSat(s)), bLum(d)); }
    case 14u: { return setLum(s, bLum(d)); }
    default:  { return setLum(d, bLum(s)); }
  }
}
fn blendRgb(mode: u32, s: vec3f, d: vec3f) -> vec3f {
  if (mode >= 12u) { return hslBlend(mode, s, d); }
  return vec3f(sep1(mode, s.r, d.r), sep1(mode, s.g, d.g), sep1(mode, s.b, d.b));
}
@fragment fn fs(@location(0) uv: vec2f) -> @location(0) vec4f {
  let s = textureSample(srcTex, samp, uv);
  let d = textureSample(dstTex, samp, uv);
  let blended = clamp(blendRgb(u.mode, s.rgb, d.rgb), vec3f(0.0), vec3f(1.0));
  let k = s.a * u.opacity;
  let outA = d.a + s.a * u.opacity * (1.0 - d.a);
  return vec4f(mix(d.rgb, blended, k), outA);
}
`;

const ALPHA_BLEND: GPUBlendState = {
  color: { srcFactor: "src-alpha", dstFactor: "one-minus-src-alpha", operation: "add" },
  alpha: { srcFactor: "one", dstFactor: "one-minus-src-alpha", operation: "add" },
};

export type ReadPixelFn = (x: number, y: number) => Promise<[number, number, number, number]>;

// Sub-pass descriptor used by the multi-pass effect runner. The bind group includes all inputs; the runner
// opens a render pass to outputView and draws the full-screen quad.
export interface SubPass {
  pipeline: GPURenderPipeline;
  bindGroup: GPUBindGroup;
  outputView: GPUTextureView;
}

type SourceBinding =
  | { type: "ext"; extTex: GPUExternalTexture }
  | { type: "copy"; copyTex: GPUTexture };

interface EffectStep {
  type: string;
  uBuf?: GPUBuffer;
  lutTex?: GPUTexture;
  lut3dTex?: GPUTexture;
  gaussRadius?: number; // blur.gaussian
  // T3 multi-pass params (Phase 1 → Phase 2)
  sharpenAmount?: number;
  noiseRedAmount?: number;
  clarityClarity?: number;
  clarityDehaze?: number;
  glowThreshold?: number;
  glowRadius?: number;
  glowIntensity?: number;
  glowWarmth?: number;
}

type LayerPlan =
  | { kind: "simple"; source: SourceBinding; uBuf: GPUBuffer }
  | { kind: "effected"; source: SourceBinding; capBuf: GPUBuffer; steps: EffectStep[]; compBuf: GPUBuffer; blendMode?: BlendMode; opacity: number };

interface RendererResources {
  device: GPUDevice;
  ctx: GPUCanvasContext;
  canvasFmt: GPUTextureFormat;
  sampler: GPUSampler;
  // shader modules
  extModule: GPUShaderModule;
  texModule: GPUShaderModule;
  satModule: GPUShaderModule;
  exposureModule: GPUShaderModule;
  contrastModule: GPUShaderModule;
  hsModule: GPUShaderModule;
  bwModule: GPUShaderModule;
  tempModule: GPUShaderModule;
  vibModule: GPUShaderModule;
  wheelsModule: GPUShaderModule;
  curvesModule: GPUShaderModule;
  hueCurvesModule: GPUShaderModule;
  lutModule: GPUShaderModule;
  compositeModule: GPUShaderModule;
  blendModule: GPUShaderModule;
  chromaModule: GPUShaderModule;
  vignetteModule: GPUShaderModule;
  grainModule: GPUShaderModule;
  gaussModule: GPUShaderModule;
  motionModule: GPUShaderModule;
  sharpenFx2Module: GPUShaderModule;
  noiseRedFx2Module: GPUShaderModule;
  clarityFx2Module: GPUShaderModule;
  glowThreshModule: GPUShaderModule;
  glowFx2Module: GPUShaderModule;
  // bind group layouts
  extBgl: GPUBindGroupLayout;
  copyBgl: GPUBindGroupLayout;
  blitBgl: GPUBindGroupLayout;
  fxBgl: GPUBindGroupLayout;
  fx2Bgl: GPUBindGroupLayout; // 2-input layout: texA, texB, samp, uniform (used by T3 spatial effects)
  // pipeline layouts
  extLayout: GPUPipelineLayout;
  copyLayout: GPUPipelineLayout;
  fxLayout: GPUPipelineLayout;
  fx2Layout: GPUPipelineLayout;
  fxLutBgl: GPUBindGroupLayout;
  fxLutLayout: GPUPipelineLayout;
  fxLut3dBgl: GPUBindGroupLayout;
  fxLut3dLayout: GPUPipelineLayout;
  blendBgl: GPUBindGroupLayout;
  blendLayout: GPUPipelineLayout;
  // eager blit/copy pipelines
  blitCanvasPipeline: GPURenderPipeline;
  blitReadbackPipeline: GPURenderPipeline;
  copyFxPipeline: GPURenderPipeline; // blit into rgba16float intermediate (copy ping→fxScratch)
  // textures
  readbackTex: GPUTexture;
  fxPing: GPUTexture;
  fxPong: GPUTexture;
  fxScratch: GPUTexture; // extra intermediate for multi-pass effects
  accumA: GPUTexture;
  accumB: GPUTexture;
}

function makeFxTexture(device: GPUDevice, w: number, h: number): GPUTexture {
  return device.createTexture({
    size: [w, h],
    format: FX_FORMAT,
    usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_SRC,
  });
}

export class FrameRenderer {
  private device: GPUDevice;
  private ctx: GPUCanvasContext;
  private canvasFmt: GPUTextureFormat;
  private sampler: GPUSampler;
  // shader modules (kept so cached pipelines can be compiled lazily)
  private extModule: GPUShaderModule;
  private texModule: GPUShaderModule;
  private satModule: GPUShaderModule;
  private exposureModule: GPUShaderModule;
  private contrastModule: GPUShaderModule;
  private hsModule: GPUShaderModule;
  private bwModule: GPUShaderModule;
  private tempModule: GPUShaderModule;
  private vibModule: GPUShaderModule;
  private wheelsModule: GPUShaderModule;
  private curvesModule: GPUShaderModule;
  private hueCurvesModule: GPUShaderModule;
  private lutModule: GPUShaderModule;
  private compositeModule: GPUShaderModule;
  private blendModule: GPUShaderModule;
  private chromaModule: GPUShaderModule;
  private vignetteModule: GPUShaderModule;
  private grainModule: GPUShaderModule;
  private gaussModule: GPUShaderModule;
  private motionModule: GPUShaderModule;
  private sharpenFx2Module: GPUShaderModule;
  private noiseRedFx2Module: GPUShaderModule;
  private clarityFx2Module: GPUShaderModule;
  private glowThreshModule: GPUShaderModule;
  private glowFx2Module: GPUShaderModule;
  // bind group layouts
  private extBgl: GPUBindGroupLayout;
  private copyBgl: GPUBindGroupLayout;
  private blitBgl: GPUBindGroupLayout;
  private fxBgl: GPUBindGroupLayout;
  private fx2Bgl: GPUBindGroupLayout;
  // pipeline layouts
  private extLayout: GPUPipelineLayout;
  private copyLayout: GPUPipelineLayout;
  private fxLayout: GPUPipelineLayout;
  private fx2Layout: GPUPipelineLayout;
  private fxLutBgl: GPUBindGroupLayout;
  private fxLutLayout: GPUPipelineLayout;
  private fxLut3dBgl: GPUBindGroupLayout;
  private fxLut3dLayout: GPUPipelineLayout;
  private blendBgl: GPUBindGroupLayout;
  private blendLayout: GPUPipelineLayout;
  cubeLUTs = new Map<string, CubeLUT>();
  // blit/copy pipelines
  private blitCanvasPipeline: GPURenderPipeline;
  private blitReadbackPipeline: GPURenderPipeline;
  private copyFxPipeline: GPURenderPipeline;
  // lazily-compiled capture/simple/effect/composite pipelines
  private pipelineCache = new Map<string, GPURenderPipeline>();
  // canvas-sized textures (recreated on resize)
  private readbackTex: GPUTexture;
  private fxPing: GPUTexture;
  private fxPong: GPUTexture;
  private fxScratch: GPUTexture;
  private accumA: GPUTexture;
  private accumB: GPUTexture;

  private constructor(r: RendererResources) {
    this.device = r.device;
    this.ctx = r.ctx;
    this.canvasFmt = r.canvasFmt;
    this.sampler = r.sampler;
    this.extModule = r.extModule;
    this.texModule = r.texModule;
    this.satModule = r.satModule;
    this.exposureModule = r.exposureModule;
    this.contrastModule = r.contrastModule;
    this.hsModule = r.hsModule;
    this.bwModule = r.bwModule;
    this.tempModule = r.tempModule;
    this.vibModule = r.vibModule;
    this.wheelsModule = r.wheelsModule;
    this.curvesModule = r.curvesModule;
    this.hueCurvesModule = r.hueCurvesModule;
    this.lutModule = r.lutModule;
    this.compositeModule = r.compositeModule;
    this.blendModule = r.blendModule;
    this.chromaModule = r.chromaModule;
    this.vignetteModule = r.vignetteModule;
    this.grainModule = r.grainModule;
    this.gaussModule = r.gaussModule;
    this.motionModule = r.motionModule;
    this.sharpenFx2Module = r.sharpenFx2Module;
    this.noiseRedFx2Module = r.noiseRedFx2Module;
    this.clarityFx2Module = r.clarityFx2Module;
    this.glowThreshModule = r.glowThreshModule;
    this.glowFx2Module = r.glowFx2Module;
    this.extBgl = r.extBgl;
    this.copyBgl = r.copyBgl;
    this.blitBgl = r.blitBgl;
    this.fxBgl = r.fxBgl;
    this.fx2Bgl = r.fx2Bgl;
    this.extLayout = r.extLayout;
    this.copyLayout = r.copyLayout;
    this.fxLayout = r.fxLayout;
    this.fx2Layout = r.fx2Layout;
    this.fxLutBgl = r.fxLutBgl;
    this.fxLutLayout = r.fxLutLayout;
    this.fxLut3dBgl = r.fxLut3dBgl;
    this.fxLut3dLayout = r.fxLut3dLayout;
    this.blendBgl = r.blendBgl;
    this.blendLayout = r.blendLayout;
    this.blitCanvasPipeline = r.blitCanvasPipeline;
    this.blitReadbackPipeline = r.blitReadbackPipeline;
    this.copyFxPipeline = r.copyFxPipeline;
    this.readbackTex = r.readbackTex;
    this.fxPing = r.fxPing;
    this.fxPong = r.fxPong;
    this.fxScratch = r.fxScratch;
    this.accumA = r.accumA;
    this.accumB = r.accumB;
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
    const satModule = device.createShaderModule({ code: WGSL_SAT });
    const exposureModule = device.createShaderModule({ code: WGSL_EXPOSURE });
    const contrastModule = device.createShaderModule({ code: WGSL_CONTRAST });
    const hsModule = device.createShaderModule({ code: WGSL_HS });
    const bwModule = device.createShaderModule({ code: WGSL_BW });
    const tempModule = device.createShaderModule({ code: WGSL_TEMP });
    const vibModule = device.createShaderModule({ code: WGSL_VIB });
    const wheelsModule = device.createShaderModule({ code: WGSL_WHEELS });
    const curvesModule = device.createShaderModule({ code: WGSL_CURVES });
    const hueCurvesModule = device.createShaderModule({ code: WGSL_HUE_CURVES });
    const lutModule = device.createShaderModule({ code: WGSL_LUT });
    const compositeModule = device.createShaderModule({ code: WGSL_COMPOSITE });
    const blendModule = device.createShaderModule({ code: WGSL_BLEND });
    const chromaModule = device.createShaderModule({ code: WGSL_CHROMA });
    const vignetteModule = device.createShaderModule({ code: WGSL_VIGNETTE });
    const grainModule = device.createShaderModule({ code: WGSL_GRAIN });
    const gaussModule = device.createShaderModule({ code: WGSL_GAUSS });
    const motionModule = device.createShaderModule({ code: WGSL_MOTION });
    const sharpenFx2Module = device.createShaderModule({ code: WGSL_SHARPEN_FX2 });
    const noiseRedFx2Module = device.createShaderModule({ code: WGSL_NOISE_RED_FX2 });
    const clarityFx2Module = device.createShaderModule({ code: WGSL_CLARITY_FX2 });
    const glowThreshModule = device.createShaderModule({ code: WGSL_GLOW_THRESH });
    const glowFx2Module = device.createShaderModule({ code: WGSL_GLOW_FX2 });

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

    // Effect + composite passes share a (texture, sampler, uniform) layout; uniform is fragment-only.
    const fxBgl = device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: "float" } },
        { binding: 1, visibility: GPUShaderStage.FRAGMENT, sampler: {} },
        { binding: 2, visibility: GPUShaderStage.FRAGMENT, buffer: { type: "uniform" } },
      ],
    });

    // 2-input layout for spatial effects (T3): texA, texB, samp, uniform.
    const fx2Bgl = device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: "float" } },
        { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: "float" } },
        { binding: 2, visibility: GPUShaderStage.FRAGMENT, sampler: {} },
        { binding: 3, visibility: GPUShaderStage.FRAGMENT, buffer: { type: "uniform" } },
      ],
    });

    const extLayout = device.createPipelineLayout({ bindGroupLayouts: [extBgl] });
    const copyLayout = device.createPipelineLayout({ bindGroupLayouts: [copyBgl] });
    const blitLayout = device.createPipelineLayout({ bindGroupLayouts: [blitBgl] });
    const fxLayout = device.createPipelineLayout({ bindGroupLayouts: [fxBgl] });
    const fx2Layout = device.createPipelineLayout({ bindGroupLayouts: [fx2Bgl] });

    const fxLutBgl = device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: "float" } },
        { binding: 1, visibility: GPUShaderStage.FRAGMENT, sampler: {} },
        { binding: 2, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: "float" } },
        { binding: 3, visibility: GPUShaderStage.FRAGMENT, sampler: {} },
      ],
    });
    const fxLutLayout = device.createPipelineLayout({ bindGroupLayouts: [fxLutBgl] });

    // color.lut: src (float), sampler, lut3d (unfilterable-float, 3d), uniform
    const fxLut3dBgl = device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: "float" } },
        { binding: 1, visibility: GPUShaderStage.FRAGMENT, sampler: {} },
        { binding: 2, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: "unfilterable-float", viewDimension: "3d" } },
        { binding: 3, visibility: GPUShaderStage.FRAGMENT, buffer: { type: "uniform" } },
      ],
    });
    const fxLut3dLayout = device.createPipelineLayout({ bindGroupLayouts: [fxLut3dBgl] });

    // 4-entry blend BGL: srcTex, sampler, dstTex, uniform {mode: u32, opacity: f32}
    const blendBgl = device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: "float" } },
        { binding: 1, visibility: GPUShaderStage.FRAGMENT, sampler: {} },
        { binding: 2, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: "float" } },
        { binding: 3, visibility: GPUShaderStage.FRAGMENT, buffer: { type: "uniform" } },
      ],
    });
    const blendLayout = device.createPipelineLayout({ bindGroupLayouts: [blendBgl] });

    // Blit pipelines: copy the (rgba16float) accumulator → canvas or readback (rgba16float is filterable).
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

    const copyFxPipeline = device.createRenderPipeline({
      layout: blitLayout,
      vertex: { module: blitModule, entryPoint: "vs" },
      fragment: { module: blitModule, entryPoint: "fs", targets: [{ format: FX_FORMAT }] },
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

    return new FrameRenderer({
      device, ctx, canvasFmt, sampler,
      extModule, texModule, satModule, exposureModule, contrastModule, hsModule, bwModule, tempModule, vibModule, wheelsModule, curvesModule, hueCurvesModule, lutModule, compositeModule, blendModule, chromaModule, vignetteModule, grainModule, gaussModule,
      motionModule, sharpenFx2Module, noiseRedFx2Module, clarityFx2Module, glowThreshModule, glowFx2Module,
      extBgl, copyBgl, blitBgl, fxBgl, fx2Bgl,
      extLayout, copyLayout, fxLayout, fx2Layout, fxLutBgl, fxLutLayout, fxLut3dBgl, fxLut3dLayout, blendBgl, blendLayout,
      blitCanvasPipeline, blitReadbackPipeline, copyFxPipeline,
      readbackTex,
      fxPing: makeFxTexture(device, cw, ch),
      fxPong: makeFxTexture(device, cw, ch),
      fxScratch: makeFxTexture(device, cw, ch),
      accumA: makeFxTexture(device, cw, ch),
      accumB: makeFxTexture(device, cw, ch),
    });
  }

  private pipelineFor(key: string, make: () => GPURenderPipeline): GPURenderPipeline {
    let p = this.pipelineCache.get(key);
    if (!p) {
      p = make();
      this.pipelineCache.set(key, p);
    }
    return p;
  }

  // Capture/pin pass: rasterize the source (positioned by transform+crop) into a samplable rgba16float, no blend.
  private capturePipeline(kind: "ext" | "tex"): GPURenderPipeline {
    if (kind === "ext") {
      return this.pipelineFor("capture-ext", () => this.device.createRenderPipeline({
        layout: this.extLayout,
        vertex: { module: this.extModule, entryPoint: "vs" },
        fragment: { module: this.extModule, entryPoint: "fs", targets: [{ format: FX_FORMAT }] },
        primitive: { topology: "triangle-strip" },
      }));
    }
    return this.pipelineFor("capture-tex", () => this.device.createRenderPipeline({
      layout: this.copyLayout,
      vertex: { module: this.texModule, entryPoint: "vs" },
      fragment: { module: this.texModule, entryPoint: "fs", targets: [{ format: FX_FORMAT }] },
      primitive: { topology: "triangle-strip" },
    }));
  }

  // Fast path: transform+crop+opacity draw, ALPHA_BLEND into the rgba16float accumulator.
  private simplePipeline(kind: "ext" | "tex"): GPURenderPipeline {
    if (kind === "ext") {
      return this.pipelineFor("simple-ext", () => this.device.createRenderPipeline({
        layout: this.extLayout,
        vertex: { module: this.extModule, entryPoint: "vs" },
        fragment: { module: this.extModule, entryPoint: "fs", targets: [{ format: FX_FORMAT, blend: ALPHA_BLEND }] },
        primitive: { topology: "triangle-strip" },
      }));
    }
    return this.pipelineFor("simple-tex", () => this.device.createRenderPipeline({
      layout: this.copyLayout,
      vertex: { module: this.texModule, entryPoint: "vs" },
      fragment: { module: this.texModule, entryPoint: "fs", targets: [{ format: FX_FORMAT, blend: ALPHA_BLEND }] },
      primitive: { topology: "triangle-strip" },
    }));
  }

  private compositePipeline(): GPURenderPipeline {
    return this.pipelineFor("composite-normal", () => this.device.createRenderPipeline({
      layout: this.fxLayout,
      vertex: { module: this.compositeModule, entryPoint: "vs" },
      fragment: { module: this.compositeModule, entryPoint: "fs", targets: [{ format: FX_FORMAT, blend: ALPHA_BLEND }] },
      primitive: { topology: "triangle-strip" },
    }));
  }

  private blendPipeline(): GPURenderPipeline {
    return this.pipelineFor("blend", () => this.device.createRenderPipeline({
      layout: this.blendLayout,
      vertex: { module: this.blendModule, entryPoint: "vs" },
      fragment: { module: this.blendModule, entryPoint: "fs", targets: [{ format: FX_FORMAT }] },
      primitive: { topology: "triangle-strip" },
    }));
  }

  // Returns the effect pipeline for a type, or null for an unimplemented effect (skipped this milestone).
  private effectPipeline(type: string): GPURenderPipeline | null {
    switch (type) {
      case "color.saturation":
        return this.pipelineFor("effect:color.saturation", () => this.device.createRenderPipeline({
          layout: this.fxLayout,
          vertex: { module: this.satModule, entryPoint: "vs" },
          fragment: { module: this.satModule, entryPoint: "fs", targets: [{ format: FX_FORMAT }] },
          primitive: { topology: "triangle-strip" },
        }));
      case "color.exposure":
        return this.pipelineFor("effect:color.exposure", () => this.device.createRenderPipeline({
          layout: this.fxLayout,
          vertex: { module: this.exposureModule, entryPoint: "vs" },
          fragment: { module: this.exposureModule, entryPoint: "fs", targets: [{ format: FX_FORMAT }] },
          primitive: { topology: "triangle-strip" },
        }));
      case "color.contrast":
        return this.pipelineFor("effect:color.contrast", () => this.device.createRenderPipeline({
          layout: this.fxLayout,
          vertex: { module: this.contrastModule, entryPoint: "vs" },
          fragment: { module: this.contrastModule, entryPoint: "fs", targets: [{ format: FX_FORMAT }] },
          primitive: { topology: "triangle-strip" },
        }));
      case "color.highlightsShadows":
        return this.pipelineFor("effect:color.highlightsShadows", () => this.device.createRenderPipeline({
          layout: this.fxLayout,
          vertex: { module: this.hsModule, entryPoint: "vs" },
          fragment: { module: this.hsModule, entryPoint: "fs", targets: [{ format: FX_FORMAT }] },
          primitive: { topology: "triangle-strip" },
        }));
      case "color.blacksWhites":
        return this.pipelineFor("effect:color.blacksWhites", () => this.device.createRenderPipeline({
          layout: this.fxLayout,
          vertex: { module: this.bwModule, entryPoint: "vs" },
          fragment: { module: this.bwModule, entryPoint: "fs", targets: [{ format: FX_FORMAT }] },
          primitive: { topology: "triangle-strip" },
        }));
      case "color.temperature":
        return this.pipelineFor("effect:color.temperature", () => this.device.createRenderPipeline({
          layout: this.fxLayout,
          vertex: { module: this.tempModule, entryPoint: "vs" },
          fragment: { module: this.tempModule, entryPoint: "fs", targets: [{ format: FX_FORMAT }] },
          primitive: { topology: "triangle-strip" },
        }));
      case "color.vibrance":
        return this.pipelineFor("effect:color.vibrance", () => this.device.createRenderPipeline({
          layout: this.fxLayout,
          vertex: { module: this.vibModule, entryPoint: "vs" },
          fragment: { module: this.vibModule, entryPoint: "fs", targets: [{ format: FX_FORMAT }] },
          primitive: { topology: "triangle-strip" },
        }));
      case "color.wheels":
        return this.pipelineFor("effect:color.wheels", () => this.device.createRenderPipeline({
          layout: this.fxLayout,
          vertex: { module: this.wheelsModule, entryPoint: "vs" },
          fragment: { module: this.wheelsModule, entryPoint: "fs", targets: [{ format: FX_FORMAT }] },
          primitive: { topology: "triangle-strip" },
        }));
      case "color.curves":
        return this.pipelineFor("effect:color.curves", () => this.device.createRenderPipeline({
          layout: this.fxLutLayout,
          vertex: { module: this.curvesModule, entryPoint: "vs" },
          fragment: { module: this.curvesModule, entryPoint: "fs", targets: [{ format: FX_FORMAT }] },
          primitive: { topology: "triangle-strip" },
        }));
      case "color.hueCurves":
        return this.pipelineFor("effect:color.hueCurves", () => this.device.createRenderPipeline({
          layout: this.fxLutLayout,
          vertex: { module: this.hueCurvesModule, entryPoint: "vs" },
          fragment: { module: this.hueCurvesModule, entryPoint: "fs", targets: [{ format: FX_FORMAT }] },
          primitive: { topology: "triangle-strip" },
        }));
      case "color.lut":
        return this.pipelineFor("effect:color.lut", () => this.device.createRenderPipeline({
          layout: this.fxLut3dLayout,
          vertex: { module: this.lutModule, entryPoint: "vs" },
          fragment: { module: this.lutModule, entryPoint: "fs", targets: [{ format: FX_FORMAT }] },
          primitive: { topology: "triangle-strip" },
        }));
      case "key.chroma":
        return this.pipelineFor("effect:key.chroma", () => this.device.createRenderPipeline({
          layout: this.fxLayout,
          vertex: { module: this.chromaModule, entryPoint: "vs" },
          fragment: { module: this.chromaModule, entryPoint: "fs", targets: [{ format: FX_FORMAT }] },
          primitive: { topology: "triangle-strip" },
        }));
      case "stylize.vignette":
        return this.pipelineFor("effect:stylize.vignette", () => this.device.createRenderPipeline({
          layout: this.fxLayout,
          vertex: { module: this.vignetteModule, entryPoint: "vs" },
          fragment: { module: this.vignetteModule, entryPoint: "fs", targets: [{ format: FX_FORMAT }] },
          primitive: { topology: "triangle-strip" },
        }));
      case "stylize.grain":
        return this.pipelineFor("effect:stylize.grain", () => this.device.createRenderPipeline({
          layout: this.fxLayout,
          vertex: { module: this.grainModule, entryPoint: "vs" },
          fragment: { module: this.grainModule, entryPoint: "fs", targets: [{ format: FX_FORMAT }] },
          primitive: { topology: "triangle-strip" },
        }));
      case "blur.motion":
        return this.pipelineFor("effect:blur.motion", () => this.device.createRenderPipeline({
          layout: this.fxLayout,
          vertex: { module: this.motionModule, entryPoint: "vs" },
          fragment: { module: this.motionModule, entryPoint: "fs", targets: [{ format: FX_FORMAT }] },
          primitive: { topology: "triangle-strip" },
        }));
      default:
        return null;
    }
  }

  private gaussPipeline(): GPURenderPipeline {
    return this.pipelineFor("effect:blur.gaussian", () => this.device.createRenderPipeline({
      layout: this.fxLayout,
      vertex: { module: this.gaussModule, entryPoint: "vs" },
      fragment: { module: this.gaussModule, entryPoint: "fs", targets: [{ format: FX_FORMAT }] },
      primitive: { topology: "triangle-strip" },
    }));
  }

  private sharpenFx2Pipeline(): GPURenderPipeline {
    return this.pipelineFor("effect:blur.sharpen-fx2", () => this.device.createRenderPipeline({
      layout: this.fx2Layout,
      vertex: { module: this.sharpenFx2Module, entryPoint: "vs" },
      fragment: { module: this.sharpenFx2Module, entryPoint: "fs", targets: [{ format: FX_FORMAT }] },
      primitive: { topology: "triangle-strip" },
    }));
  }

  private noiseRedFx2Pipeline(): GPURenderPipeline {
    return this.pipelineFor("effect:blur.noiseReduction-fx2", () => this.device.createRenderPipeline({
      layout: this.fx2Layout,
      vertex: { module: this.noiseRedFx2Module, entryPoint: "vs" },
      fragment: { module: this.noiseRedFx2Module, entryPoint: "fs", targets: [{ format: FX_FORMAT }] },
      primitive: { topology: "triangle-strip" },
    }));
  }

  private clarityFx2Pipeline(): GPURenderPipeline {
    return this.pipelineFor("effect:detail.clarity-fx2", () => this.device.createRenderPipeline({
      layout: this.fx2Layout,
      vertex: { module: this.clarityFx2Module, entryPoint: "vs" },
      fragment: { module: this.clarityFx2Module, entryPoint: "fs", targets: [{ format: FX_FORMAT }] },
      primitive: { topology: "triangle-strip" },
    }));
  }

  private glowThreshPipeline(): GPURenderPipeline {
    return this.pipelineFor("effect:stylize.glow-thresh", () => this.device.createRenderPipeline({
      layout: this.fxLayout,
      vertex: { module: this.glowThreshModule, entryPoint: "vs" },
      fragment: { module: this.glowThreshModule, entryPoint: "fs", targets: [{ format: FX_FORMAT }] },
      primitive: { topology: "triangle-strip" },
    }));
  }

  private glowFx2Pipeline(): GPURenderPipeline {
    return this.pipelineFor("effect:stylize.glow-fx2", () => this.device.createRenderPipeline({
      layout: this.fx2Layout,
      vertex: { module: this.glowFx2Module, entryPoint: "vs" },
      fragment: { module: this.glowFx2Module, entryPoint: "fs", targets: [{ format: FX_FORMAT }] },
      primitive: { topology: "triangle-strip" },
    }));
  }

  // Resolved-param uniform bytes for an effect, or null if the type is unimplemented or multi-pass.
  // clip-relative frame is 0 for M9B (static effect params; keyframed effect params are a later fold).
  private effectStepData(eff: Effect, rw: number, rh: number): Float32Array<ArrayBuffer> | null {
    switch (eff.type) {
      case "color.saturation":
        return new Float32Array([resolveParam(eff.params.amount, 0, 1)]);
      case "color.exposure":
        return new Float32Array([resolveParam(eff.params.ev, 0, 0)]);
      case "color.contrast":
        return new Float32Array([resolveParam(eff.params.amount, 0, 1)]);
      case "color.highlightsShadows":
        return new Float32Array([resolveParam(eff.params.highlights, 0, 0), resolveParam(eff.params.shadows, 0, 0)]);
      case "color.blacksWhites":
        return new Float32Array([resolveParam(eff.params.blacks, 0, 0), resolveParam(eff.params.whites, 0, 0)]);
      case "color.temperature":
        return new Float32Array([resolveParam(eff.params.temperature, 0, 6500), resolveParam(eff.params.tint, 0, 0)]);
      case "color.vibrance":
        return new Float32Array([resolveParam(eff.params.amount, 0, 0)]);
      case "color.wheels":
        return new Float32Array([
          resolveParam(eff.params.lift_x, 0, 0),
          resolveParam(eff.params.lift_y, 0, 0),
          resolveParam(eff.params.lift_m, 0, 0),
          0,
          resolveParam(eff.params.gamma_x, 0, 0),
          resolveParam(eff.params.gamma_y, 0, 0),
          resolveParam(eff.params.gamma_m, 0, 1),
          0,
          resolveParam(eff.params.gain_x, 0, 0),
          resolveParam(eff.params.gain_y, 0, 0),
          resolveParam(eff.params.gain_m, 0, 1),
          0,
        ]);
      case "key.chroma":
        return new Float32Array([
          resolveParam(eff.params.keyHue, 0, 0.333),
          resolveParam(eff.params.tolerance, 0, 0),
          resolveParam(eff.params.softness, 0, 0.5),
          resolveParam(eff.params.spill, 0, 0.5),
        ]);
      case "stylize.vignette":
        return new Float32Array([
          resolveParam(eff.params.amount, 0, 0),
          resolveParam(eff.params.midpoint, 0, 0.5),
          resolveParam(eff.params.roundness, 0, 0),
          resolveParam(eff.params.feather, 0, 0.5),
        ]);
      case "stylize.grain":
        return new Float32Array([
          resolveParam(eff.params.amount, 0, 0),
          resolveParam(eff.params.size, 0, 1.5),
          rw,
          rh,
        ]);
      case "blur.motion":
        return new Float32Array([
          resolveParam(eff.params.angle, 0, 0),
          resolveParam(eff.params.radius, 0, 0),
          rw,
          rh,
        ]);
      default:
        return null;
    }
  }

  private bakeCurvesLut(device: GPUDevice, curve: GradeCurve): GPUTexture {
    const data = new Uint8Array(256 * 4);
    for (let i = 0; i < 256; i++) {
      const x = i / 255;
      data[i * 4 + 0] = Math.round(evalCurve(curve.master, x) * 255);
      data[i * 4 + 1] = Math.round(evalCurve(curve.red, x) * 255);
      data[i * 4 + 2] = Math.round(evalCurve(curve.green, x) * 255);
      data[i * 4 + 3] = Math.round(evalCurve(curve.blue, x) * 255);
    }
    const tex = device.createTexture({
      size: [256, 1], format: "rgba8unorm",
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
    });
    device.queue.writeTexture({ texture: tex }, data, { bytesPerRow: 1024 }, [256, 1]);
    return tex;
  }

  private bakeHueCurvesLut(device: GPUDevice, curves: HueCurves): GPUTexture {
    const data = new Uint8Array(256 * 4);
    for (let i = 0; i < 256; i++) {
      const x = i / 255;
      data[i * 4 + 0] = Math.round(evalHueCurve(curves.hueVsHue, x) * 255);
      data[i * 4 + 1] = Math.round(evalHueCurve(curves.hueVsSat, x) * 255);
      data[i * 4 + 2] = Math.round(evalHueCurve(curves.hueVsLum, x) * 255);
      data[i * 4 + 3] = 255;
    }
    const tex = device.createTexture({
      size: [256, 1], format: "rgba8unorm",
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
    });
    device.queue.writeTexture({ texture: tex }, data, { bytesPerRow: 1024 }, [256, 1]);
    return tex;
  }

  private uploadCubeLutTexture(device: GPUDevice, lut: CubeLUT): GPUTexture {
    const n = lut.dimension;
    const tex = device.createTexture({
      size: [n, n, n],
      format: "rgba32float",
      dimension: "3d",
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
    });
    const bytesPerTexel = 16; // rgba32float: 4 channels × 4 bytes each
    const unpaddedBytesPerRow = n * bytesPerTexel;
    const bytesPerRow = Math.ceil(unpaddedBytesPerRow / 256) * 256;
    const buf = new Uint8Array(bytesPerRow * n * n);
    const view = new DataView(buf.buffer);
    for (let b = 0; b < n; b++) {
      for (let g = 0; g < n; g++) {
        for (let r = 0; r < n; r++) {
          const srcIdx = (b * n * n + g * n + r) * 4;
          const dstBase = (b * n + g) * bytesPerRow + r * bytesPerTexel;
          view.setFloat32(dstBase + 0, lut.data[srcIdx]!, true);
          view.setFloat32(dstBase + 4, lut.data[srcIdx + 1]!, true);
          view.setFloat32(dstBase + 8, lut.data[srcIdx + 2]!, true);
          view.setFloat32(dstBase + 12, lut.data[srcIdx + 3]!, true);
        }
      }
    }
    device.queue.writeTexture({ texture: tex }, buf, { bytesPerRow, rowsPerImage: n }, [n, n, n]);
    return tex;
  }

  private resizeIntermediates(w: number, h: number): void {
    this.fxPing.destroy();
    this.fxPong.destroy();
    this.fxScratch.destroy();
    this.accumA.destroy();
    this.accumB.destroy();
    this.fxPing = makeFxTexture(this.device, w, h);
    this.fxPong = makeFxTexture(this.device, w, h);
    this.fxScratch = makeFxTexture(this.device, w, h);
    this.accumA = makeFxTexture(this.device, w, h);
    this.accumB = makeFxTexture(this.device, w, h);
  }

  async composite(layers: CompositeLayer[], renderSize: Size): Promise<void> {
    const device = this.device;
    const rw = renderSize.width;
    const rh = renderSize.height;

    // Recreate canvas-sized textures if size changed.
    if (this.readbackTex.width !== rw || this.readbackTex.height !== rh) {
      this.readbackTex.destroy();
      this.readbackTex = device.createTexture({
        size: [rw, rh],
        format: "rgba8unorm",
        usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
      });
    }
    if (this.accumA.width !== rw || this.accumA.height !== rh) {
      this.resizeIntermediates(rw, rh);
    }

    const tempTextures: GPUTexture[] = [];
    const tempBuffers: GPUBuffer[] = [];
    const plans: LayerPlan[] = [];

    const bigUniform = (layer: CompositeLayer, opacity: number): Float32Array<ArrayBuffer> => {
      const mat = layer.transform;
      const c = layer.crop;
      return new Float32Array([
        mat.a, mat.b,
        mat.c, mat.d,
        mat.e, mat.f,
        layer.frame.displayWidth, layer.frame.displayHeight,
        rw, rh,
        opacity,
        c.left, c.top, c.right, c.bottom,
        0, // _pad
      ]);
    };
    const uniformBuffer = (data: Float32Array<ArrayBuffer>, sizeBytes: number): GPUBuffer => {
      const buf = device.createBuffer({
        size: sizeBytes,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      });
      device.queue.writeBuffer(buf, 0, data);
      tempBuffers.push(buf);
      return buf;
    };

    // Phase 1 (async, no encoder open): import/copy each layer's pixels + build its plan.
    try {
      for (const layer of layers) {
        const enabledEffects = (layer.effects ?? []).filter((e) => e.enabled);
        const bm: BlendMode | undefined = layer.blendMode;
        const normalBlend = bm === undefined || bm === "normal";
        const simple = enabledEffects.length === 0 && normalBlend;

        // Import (zero-copy) or copy (software) the source once.
        let source: SourceBinding;
        let extTex: GPUExternalTexture | null = null;
        try {
          extTex = device.importExternalTexture({ source: layer.frame });
        } catch {
          extTex = null;
        }
        if (extTex !== null) {
          source = { type: "ext", extTex };
        } else {
          const natW = layer.frame.displayWidth;
          const natH = layer.frame.displayHeight;
          const unpadded = natW * 4;
          const bytesPerRow = Math.ceil(unpadded / 256) * 256;
          const pixelBuf = new Uint8Array(bytesPerRow * natH);
          await layer.frame.copyTo(pixelBuf, { format: "RGBA", layout: [{ offset: 0, stride: bytesPerRow }] });
          const copyTex = device.createTexture({
            size: [natW, natH],
            format: "rgba8unorm",
            usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
          });
          tempTextures.push(copyTex);
          device.queue.writeTexture({ texture: copyTex }, pixelBuf, { bytesPerRow }, [natW, natH]);
          source = { type: "copy", copyTex };
        }

        if (simple) {
          plans.push({ kind: "simple", source, uBuf: uniformBuffer(bigUniform(layer, layer.opacity), UNIFORMS_F32 * 4) });
        } else {
          // Capture pins the source into fxPing with transform+crop but NO opacity (opacity is applied at composite).
          const capBuf = uniformBuffer(bigUniform(layer, 1), UNIFORMS_F32 * 4);
          const steps: EffectStep[] = [];
          for (const eff of canonicalSort(enabledEffects)) {
            if (eff.type === "blur.gaussian") {
              steps.push({ type: eff.type, gaussRadius: resolveParam(eff.params.radius, 0, 8) });
              continue;
            }
            if (eff.type === "color.curves") {
              const lutTex = this.bakeCurvesLut(device, parseGradeCurve(eff.params.curve?.string));
              tempTextures.push(lutTex);
              steps.push({ type: eff.type, lutTex });
              continue;
            }
            if (eff.type === "color.hueCurves") {
              const lutTex = this.bakeHueCurvesLut(device, parseHueCurves(eff.params.curves?.string));
              tempTextures.push(lutTex);
              steps.push({ type: eff.type, lutTex });
              continue;
            }
            if (eff.type === "color.lut") {
              const path = eff.params.path?.string ?? "";
              const cubeLut = this.cubeLUTs.get(path);
              if (!cubeLut) continue;
              const lut3dTex = this.uploadCubeLutTexture(device, cubeLut);
              tempTextures.push(lut3dTex);
              const intensity = resolveParam(eff.params.intensity, 0, 1);
              const uBuf = uniformBuffer(new Float32Array([intensity, cubeLut.dimension, 0, 0]), 16);
              steps.push({ type: eff.type, lut3dTex, uBuf });
              continue;
            }
            if (eff.type === "blur.sharpen") {
              steps.push({ type: eff.type, sharpenAmount: resolveParam(eff.params.amount, 0, 0.4) });
              continue;
            }
            if (eff.type === "blur.noiseReduction") {
              steps.push({ type: eff.type, noiseRedAmount: resolveParam(eff.params.amount, 0, 0) });
              continue;
            }
            if (eff.type === "detail.clarity") {
              steps.push({ type: eff.type, clarityClarity: resolveParam(eff.params.clarity, 0, 0), clarityDehaze: resolveParam(eff.params.dehaze, 0, 0) });
              continue;
            }
            if (eff.type === "stylize.glow") {
              steps.push({
                type: eff.type,
                glowThreshold: resolveParam(eff.params.threshold, 0, 0.6),
                glowRadius: resolveParam(eff.params.radius, 0, 20),
                glowIntensity: resolveParam(eff.params.intensity, 0, 0),
                glowWarmth: resolveParam(eff.params.warmth, 0, 0),
              });
              continue;
            }
            const data = this.effectStepData(eff, rw, rh);
            if (!data) continue; // unimplemented effect type this milestone
            steps.push({ type: eff.type, uBuf: uniformBuffer(data, Math.max(16, data.byteLength)) });
          }
          const compBuf = uniformBuffer(new Float32Array([layer.opacity]), 16);
          plans.push({ kind: "effected", source, capBuf, steps, compBuf, blendMode: bm, opacity: layer.opacity });
        }
      }

      // Phase 2 (synchronous): one encoder, capture/effect/composite/blit passes in order, one submit.
      // curAccum/otherAccum ping-pong: advanced blend passes swap them; normal paths draw into curAccum.
      let curAccum = this.accumA;
      let otherAccum = this.accumB;
      const encoder = device.createCommandEncoder();

      // Clear curAccum once; every subsequent write to curAccum loads.
      encoder.beginRenderPass({
        colorAttachments: [{ view: curAccum.createView(), clearValue: { r: 0, g: 0, b: 0, a: 0 }, loadOp: "clear", storeOp: "store" }],
      }).end();

      let i = 0;
      while (i < plans.length) {
        const plan = plans[i]!;
        if (plan.kind === "simple") {
          // Batch consecutive simple layers into one ALPHA_BLEND pass (the fast path).
          const pass = encoder.beginRenderPass({
            colorAttachments: [{ view: curAccum.createView(), loadOp: "load", storeOp: "store" }],
          });
          while (i < plans.length && plans[i]!.kind === "simple") {
            const sp = plans[i] as Extract<LayerPlan, { kind: "simple" }>;
            if (sp.source.type === "ext") {
              pass.setPipeline(this.simplePipeline("ext"));
              pass.setBindGroup(0, device.createBindGroup({
                layout: this.extBgl,
                entries: [
                  { binding: 0, resource: sp.source.extTex },
                  { binding: 1, resource: this.sampler },
                  { binding: 2, resource: { buffer: sp.uBuf } },
                ],
              }));
            } else {
              pass.setPipeline(this.simplePipeline("tex"));
              pass.setBindGroup(0, device.createBindGroup({
                layout: this.copyBgl,
                entries: [
                  { binding: 0, resource: sp.source.copyTex.createView() },
                  { binding: 1, resource: this.sampler },
                  { binding: 2, resource: { buffer: sp.uBuf } },
                ],
              }));
            }
            pass.draw(4);
            i++;
          }
          pass.end();
          continue;
        }

        // Effected layer: capture → effect ping-pong → normal composite into the accumulator.
        const ep = plan;
        let ping = this.fxPing;
        let pong = this.fxPong;

        // (a) Capture pass → ping (cleared transparent, no blend, opacity=1). Pins the external texture.
        const cap = encoder.beginRenderPass({
          colorAttachments: [{ view: ping.createView(), clearValue: { r: 0, g: 0, b: 0, a: 0 }, loadOp: "clear", storeOp: "store" }],
        });
        if (ep.source.type === "ext") {
          cap.setPipeline(this.capturePipeline("ext"));
          cap.setBindGroup(0, device.createBindGroup({
            layout: this.extBgl,
            entries: [
              { binding: 0, resource: ep.source.extTex },
              { binding: 1, resource: this.sampler },
              { binding: 2, resource: { buffer: ep.capBuf } },
            ],
          }));
        } else {
          cap.setPipeline(this.capturePipeline("tex"));
          cap.setBindGroup(0, device.createBindGroup({
            layout: this.copyBgl,
            entries: [
              { binding: 0, resource: ep.source.copyTex.createView() },
              { binding: 1, resource: this.sampler },
              { binding: 2, resource: { buffer: ep.capBuf } },
            ],
          }));
        }
        cap.draw(4);
        cap.end();

        // (b) Effect passes in canonical order: ping → pong full-screen, then swap.
        for (const step of ep.steps) {
          // Multi-pass: blur.gaussian runs H (ping→scratch) then V (scratch→pong), then swap.
          if (step.type === "blur.gaussian") {
            const radius = step.gaussRadius ?? 8;
            const hData = new Float32Array([1 / rw, 0, radius, 0]);
            const hBuf = device.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
            device.queue.writeBuffer(hBuf, 0, hData);
            tempBuffers.push(hBuf);
            const hPass = encoder.beginRenderPass({
              colorAttachments: [{ view: this.fxScratch.createView(), clearValue: { r: 0, g: 0, b: 0, a: 0 }, loadOp: "clear", storeOp: "store" }],
            });
            hPass.setPipeline(this.gaussPipeline());
            hPass.setBindGroup(0, device.createBindGroup({
              layout: this.fxBgl,
              entries: [
                { binding: 0, resource: ping.createView() },
                { binding: 1, resource: this.sampler },
                { binding: 2, resource: { buffer: hBuf } },
              ],
            }));
            hPass.draw(4);
            hPass.end();
            const vData = new Float32Array([0, 1 / rh, radius, 0]);
            const vBuf = device.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
            device.queue.writeBuffer(vBuf, 0, vData);
            tempBuffers.push(vBuf);
            const vPass = encoder.beginRenderPass({
              colorAttachments: [{ view: pong.createView(), clearValue: { r: 0, g: 0, b: 0, a: 0 }, loadOp: "clear", storeOp: "store" }],
            });
            vPass.setPipeline(this.gaussPipeline());
            vPass.setBindGroup(0, device.createBindGroup({
              layout: this.fxBgl,
              entries: [
                { binding: 0, resource: this.fxScratch.createView() },
                { binding: 1, resource: this.sampler },
                { binding: 2, resource: { buffer: vBuf } },
              ],
            }));
            vPass.draw(4);
            vPass.end();
            const tmp = ping; ping = pong; pong = tmp;
            continue;
          }

          // blur.sharpen: copy ping→fxScratch (orig), H:ping→pong, V:pong→ping (blur), fx2 combine.
          if (step.type === "blur.sharpen") {
            const cpPass = encoder.beginRenderPass({
              colorAttachments: [{ view: this.fxScratch.createView(), clearValue: { r: 0, g: 0, b: 0, a: 0 }, loadOp: "clear", storeOp: "store" }],
            });
            cpPass.setPipeline(this.copyFxPipeline);
            cpPass.setBindGroup(0, device.createBindGroup({
              layout: this.blitBgl,
              entries: [{ binding: 0, resource: ping.createView() }, { binding: 1, resource: this.sampler }],
            }));
            cpPass.draw(4); cpPass.end();
            const sRadius = 2;
            const shData = new Float32Array([1 / rw, 0, sRadius, 0]);
            const shBuf = device.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
            device.queue.writeBuffer(shBuf, 0, shData); tempBuffers.push(shBuf);
            const shH = encoder.beginRenderPass({
              colorAttachments: [{ view: pong.createView(), clearValue: { r: 0, g: 0, b: 0, a: 0 }, loadOp: "clear", storeOp: "store" }],
            });
            shH.setPipeline(this.gaussPipeline());
            shH.setBindGroup(0, device.createBindGroup({ layout: this.fxBgl, entries: [{ binding: 0, resource: ping.createView() }, { binding: 1, resource: this.sampler }, { binding: 2, resource: { buffer: shBuf } }] }));
            shH.draw(4); shH.end();
            const svData = new Float32Array([0, 1 / rh, sRadius, 0]);
            const svBuf = device.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
            device.queue.writeBuffer(svBuf, 0, svData); tempBuffers.push(svBuf);
            const shV = encoder.beginRenderPass({
              colorAttachments: [{ view: ping.createView(), clearValue: { r: 0, g: 0, b: 0, a: 0 }, loadOp: "clear", storeOp: "store" }],
            });
            shV.setPipeline(this.gaussPipeline());
            shV.setBindGroup(0, device.createBindGroup({ layout: this.fxBgl, entries: [{ binding: 0, resource: pong.createView() }, { binding: 1, resource: this.sampler }, { binding: 2, resource: { buffer: svBuf } }] }));
            shV.draw(4); shV.end();
            const sfData = new Float32Array([step.sharpenAmount ?? 0.4]);
            const sfBuf = device.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
            device.queue.writeBuffer(sfBuf, 0, sfData); tempBuffers.push(sfBuf);
            const sfPass = encoder.beginRenderPass({
              colorAttachments: [{ view: pong.createView(), clearValue: { r: 0, g: 0, b: 0, a: 0 }, loadOp: "clear", storeOp: "store" }],
            });
            sfPass.setPipeline(this.sharpenFx2Pipeline());
            sfPass.setBindGroup(0, device.createBindGroup({ layout: this.fx2Bgl, entries: [{ binding: 0, resource: ping.createView() }, { binding: 1, resource: this.fxScratch.createView() }, { binding: 2, resource: this.sampler }, { binding: 3, resource: { buffer: sfBuf } }] }));
            sfPass.draw(4); sfPass.end();
            const stmp = ping; ping = pong; pong = stmp;
            continue;
          }

          // blur.noiseReduction: copy ping→fxScratch, H:ping→pong, V:pong→ping (blur), fx2 mix.
          if (step.type === "blur.noiseReduction") {
            const cpPass = encoder.beginRenderPass({
              colorAttachments: [{ view: this.fxScratch.createView(), clearValue: { r: 0, g: 0, b: 0, a: 0 }, loadOp: "clear", storeOp: "store" }],
            });
            cpPass.setPipeline(this.copyFxPipeline);
            cpPass.setBindGroup(0, device.createBindGroup({
              layout: this.blitBgl,
              entries: [{ binding: 0, resource: ping.createView() }, { binding: 1, resource: this.sampler }],
            }));
            cpPass.draw(4); cpPass.end();
            const nRadius = 2;
            const nhData = new Float32Array([1 / rw, 0, nRadius, 0]);
            const nhBuf = device.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
            device.queue.writeBuffer(nhBuf, 0, nhData); tempBuffers.push(nhBuf);
            const nrH = encoder.beginRenderPass({
              colorAttachments: [{ view: pong.createView(), clearValue: { r: 0, g: 0, b: 0, a: 0 }, loadOp: "clear", storeOp: "store" }],
            });
            nrH.setPipeline(this.gaussPipeline());
            nrH.setBindGroup(0, device.createBindGroup({ layout: this.fxBgl, entries: [{ binding: 0, resource: ping.createView() }, { binding: 1, resource: this.sampler }, { binding: 2, resource: { buffer: nhBuf } }] }));
            nrH.draw(4); nrH.end();
            const nvData = new Float32Array([0, 1 / rh, nRadius, 0]);
            const nvBuf = device.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
            device.queue.writeBuffer(nvBuf, 0, nvData); tempBuffers.push(nvBuf);
            const nrV = encoder.beginRenderPass({
              colorAttachments: [{ view: ping.createView(), clearValue: { r: 0, g: 0, b: 0, a: 0 }, loadOp: "clear", storeOp: "store" }],
            });
            nrV.setPipeline(this.gaussPipeline());
            nrV.setBindGroup(0, device.createBindGroup({ layout: this.fxBgl, entries: [{ binding: 0, resource: pong.createView() }, { binding: 1, resource: this.sampler }, { binding: 2, resource: { buffer: nvBuf } }] }));
            nrV.draw(4); nrV.end();
            const nfData = new Float32Array([step.noiseRedAmount ?? 0]);
            const nfBuf = device.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
            device.queue.writeBuffer(nfBuf, 0, nfData); tempBuffers.push(nfBuf);
            const nfPass = encoder.beginRenderPass({
              colorAttachments: [{ view: pong.createView(), clearValue: { r: 0, g: 0, b: 0, a: 0 }, loadOp: "clear", storeOp: "store" }],
            });
            nfPass.setPipeline(this.noiseRedFx2Pipeline());
            nfPass.setBindGroup(0, device.createBindGroup({ layout: this.fx2Bgl, entries: [{ binding: 0, resource: ping.createView() }, { binding: 1, resource: this.fxScratch.createView() }, { binding: 2, resource: this.sampler }, { binding: 3, resource: { buffer: nfBuf } }] }));
            nfPass.draw(4); nfPass.end();
            const ntmp = ping; ping = pong; pong = ntmp;
            continue;
          }

          // detail.clarity: copy ping→fxScratch, H:ping→pong, V:pong→ping (localAvg), fx2 combine.
          if (step.type === "detail.clarity") {
            const cpPass = encoder.beginRenderPass({
              colorAttachments: [{ view: this.fxScratch.createView(), clearValue: { r: 0, g: 0, b: 0, a: 0 }, loadOp: "clear", storeOp: "store" }],
            });
            cpPass.setPipeline(this.copyFxPipeline);
            cpPass.setBindGroup(0, device.createBindGroup({
              layout: this.blitBgl,
              entries: [{ binding: 0, resource: ping.createView() }, { binding: 1, resource: this.sampler }],
            }));
            cpPass.draw(4); cpPass.end();
            const clRadius = 20;
            const clhData = new Float32Array([1 / rw, 0, clRadius, 0]);
            const clhBuf = device.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
            device.queue.writeBuffer(clhBuf, 0, clhData); tempBuffers.push(clhBuf);
            const clH = encoder.beginRenderPass({
              colorAttachments: [{ view: pong.createView(), clearValue: { r: 0, g: 0, b: 0, a: 0 }, loadOp: "clear", storeOp: "store" }],
            });
            clH.setPipeline(this.gaussPipeline());
            clH.setBindGroup(0, device.createBindGroup({ layout: this.fxBgl, entries: [{ binding: 0, resource: ping.createView() }, { binding: 1, resource: this.sampler }, { binding: 2, resource: { buffer: clhBuf } }] }));
            clH.draw(4); clH.end();
            const clvData = new Float32Array([0, 1 / rh, clRadius, 0]);
            const clvBuf = device.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
            device.queue.writeBuffer(clvBuf, 0, clvData); tempBuffers.push(clvBuf);
            const clV = encoder.beginRenderPass({
              colorAttachments: [{ view: ping.createView(), clearValue: { r: 0, g: 0, b: 0, a: 0 }, loadOp: "clear", storeOp: "store" }],
            });
            clV.setPipeline(this.gaussPipeline());
            clV.setBindGroup(0, device.createBindGroup({ layout: this.fxBgl, entries: [{ binding: 0, resource: pong.createView() }, { binding: 1, resource: this.sampler }, { binding: 2, resource: { buffer: clvBuf } }] }));
            clV.draw(4); clV.end();
            const clfData = new Float32Array([step.clarityClarity ?? 0, step.clarityDehaze ?? 0]);
            const clfBuf = device.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
            device.queue.writeBuffer(clfBuf, 0, clfData); tempBuffers.push(clfBuf);
            const clfPass = encoder.beginRenderPass({
              colorAttachments: [{ view: pong.createView(), clearValue: { r: 0, g: 0, b: 0, a: 0 }, loadOp: "clear", storeOp: "store" }],
            });
            clfPass.setPipeline(this.clarityFx2Pipeline());
            clfPass.setBindGroup(0, device.createBindGroup({ layout: this.fx2Bgl, entries: [{ binding: 0, resource: ping.createView() }, { binding: 1, resource: this.fxScratch.createView() }, { binding: 2, resource: this.sampler }, { binding: 3, resource: { buffer: clfBuf } }] }));
            clfPass.draw(4); clfPass.end();
            const cltmp = ping; ping = pong; pong = cltmp;
            continue;
          }

          // stylize.glow: copy ping→fxScratch, thresh:ping→pong, H:pong→ping, V:ping→pong (blurred-bright), fx2 add.
          if (step.type === "stylize.glow") {
            const cpPass = encoder.beginRenderPass({
              colorAttachments: [{ view: this.fxScratch.createView(), clearValue: { r: 0, g: 0, b: 0, a: 0 }, loadOp: "clear", storeOp: "store" }],
            });
            cpPass.setPipeline(this.copyFxPipeline);
            cpPass.setBindGroup(0, device.createBindGroup({
              layout: this.blitBgl,
              entries: [{ binding: 0, resource: ping.createView() }, { binding: 1, resource: this.sampler }],
            }));
            cpPass.draw(4); cpPass.end();
            const gtData = new Float32Array([step.glowThreshold ?? 0.6]);
            const gtBuf = device.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
            device.queue.writeBuffer(gtBuf, 0, gtData); tempBuffers.push(gtBuf);
            const gtPass = encoder.beginRenderPass({
              colorAttachments: [{ view: pong.createView(), clearValue: { r: 0, g: 0, b: 0, a: 0 }, loadOp: "clear", storeOp: "store" }],
            });
            gtPass.setPipeline(this.glowThreshPipeline());
            gtPass.setBindGroup(0, device.createBindGroup({ layout: this.fxBgl, entries: [{ binding: 0, resource: ping.createView() }, { binding: 1, resource: this.sampler }, { binding: 2, resource: { buffer: gtBuf } }] }));
            gtPass.draw(4); gtPass.end();
            const gRadius = step.glowRadius ?? 20;
            const ghData = new Float32Array([1 / rw, 0, gRadius, 0]);
            const ghBuf = device.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
            device.queue.writeBuffer(ghBuf, 0, ghData); tempBuffers.push(ghBuf);
            const gH = encoder.beginRenderPass({
              colorAttachments: [{ view: ping.createView(), clearValue: { r: 0, g: 0, b: 0, a: 0 }, loadOp: "clear", storeOp: "store" }],
            });
            gH.setPipeline(this.gaussPipeline());
            gH.setBindGroup(0, device.createBindGroup({ layout: this.fxBgl, entries: [{ binding: 0, resource: pong.createView() }, { binding: 1, resource: this.sampler }, { binding: 2, resource: { buffer: ghBuf } }] }));
            gH.draw(4); gH.end();
            const gvData = new Float32Array([0, 1 / rh, gRadius, 0]);
            const gvBuf = device.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
            device.queue.writeBuffer(gvBuf, 0, gvData); tempBuffers.push(gvBuf);
            const gV = encoder.beginRenderPass({
              colorAttachments: [{ view: pong.createView(), clearValue: { r: 0, g: 0, b: 0, a: 0 }, loadOp: "clear", storeOp: "store" }],
            });
            gV.setPipeline(this.gaussPipeline());
            gV.setBindGroup(0, device.createBindGroup({ layout: this.fxBgl, entries: [{ binding: 0, resource: ping.createView() }, { binding: 1, resource: this.sampler }, { binding: 2, resource: { buffer: gvBuf } }] }));
            gV.draw(4); gV.end();
            const gfData = new Float32Array([step.glowIntensity ?? 0, step.glowWarmth ?? 0]);
            const gfBuf = device.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
            device.queue.writeBuffer(gfBuf, 0, gfData); tempBuffers.push(gfBuf);
            const gfPass = encoder.beginRenderPass({
              colorAttachments: [{ view: ping.createView(), clearValue: { r: 0, g: 0, b: 0, a: 0 }, loadOp: "clear", storeOp: "store" }],
            });
            gfPass.setPipeline(this.glowFx2Pipeline());
            gfPass.setBindGroup(0, device.createBindGroup({ layout: this.fx2Bgl, entries: [{ binding: 0, resource: pong.createView() }, { binding: 1, resource: this.fxScratch.createView() }, { binding: 2, resource: this.sampler }, { binding: 3, resource: { buffer: gfBuf } }] }));
            gfPass.draw(4); gfPass.end();
            continue;
          }

          const pipe = this.effectPipeline(step.type);
          if (!pipe) continue;
          const pass = encoder.beginRenderPass({
            colorAttachments: [{ view: pong.createView(), clearValue: { r: 0, g: 0, b: 0, a: 0 }, loadOp: "clear", storeOp: "store" }],
          });
          pass.setPipeline(pipe);
          if (step.lut3dTex) {
            pass.setBindGroup(0, device.createBindGroup({
              layout: this.fxLut3dBgl,
              entries: [
                { binding: 0, resource: ping.createView() },
                { binding: 1, resource: this.sampler },
                { binding: 2, resource: step.lut3dTex.createView() },
                { binding: 3, resource: { buffer: step.uBuf! } },
              ],
            }));
          } else if (step.lutTex) {
            pass.setBindGroup(0, device.createBindGroup({
              layout: this.fxLutBgl,
              entries: [
                { binding: 0, resource: ping.createView() },
                { binding: 1, resource: this.sampler },
                { binding: 2, resource: step.lutTex.createView() },
                { binding: 3, resource: this.sampler },
              ],
            }));
          } else {
            pass.setBindGroup(0, device.createBindGroup({
              layout: this.fxBgl,
              entries: [
                { binding: 0, resource: ping.createView() },
                { binding: 1, resource: this.sampler },
                { binding: 2, resource: { buffer: step.uBuf! } },
              ],
            }));
          }
          pass.draw(4);
          pass.end();
          const tmp = ping;
          ping = pong;
          pong = tmp;
        }

        // (c) Composite: normal blend → ALPHA_BLEND into curAccum; advanced blend → blend pass into otherAccum then swap.
        const blendModeEp = ep.blendMode;
        if (blendModeEp !== undefined && blendModeEp !== "normal") {
          // Build blend uniform: { mode: u32, opacity: f32 } — 16-byte aligned buffer.
          const blendData = new ArrayBuffer(16);
          const dv = new DataView(blendData);
          dv.setUint32(0, BLEND_MODES.indexOf(blendModeEp), true);
          dv.setFloat32(4, ep.opacity, true);
          const blendUBuf = device.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
          device.queue.writeBuffer(blendUBuf, 0, blendData);
          tempBuffers.push(blendUBuf);

          const blendPass = encoder.beginRenderPass({
            colorAttachments: [{ view: otherAccum.createView(), clearValue: { r: 0, g: 0, b: 0, a: 0 }, loadOp: "clear", storeOp: "store" }],
          });
          blendPass.setPipeline(this.blendPipeline());
          blendPass.setBindGroup(0, device.createBindGroup({
            layout: this.blendBgl,
            entries: [
              { binding: 0, resource: ping.createView() },
              { binding: 1, resource: this.sampler },
              { binding: 2, resource: curAccum.createView() },
              { binding: 3, resource: { buffer: blendUBuf } },
            ],
          }));
          blendPass.draw(4);
          blendPass.end();
          // Swap curAccum <-> otherAccum so subsequent passes read the composited result.
          const tmpAccum = curAccum;
          curAccum = otherAccum;
          otherAccum = tmpAccum;
        } else {
          const comp = encoder.beginRenderPass({
            colorAttachments: [{ view: curAccum.createView(), loadOp: "load", storeOp: "store" }],
          });
          comp.setPipeline(this.compositePipeline());
          comp.setBindGroup(0, device.createBindGroup({
            layout: this.fxBgl,
            entries: [
              { binding: 0, resource: ping.createView() },
              { binding: 1, resource: this.sampler },
              { binding: 2, resource: { buffer: ep.compBuf } },
            ],
          }));
          comp.draw(4);
          comp.end();
        }
        i++;
      }

      // Final: blit curAccum (rgba16float) → canvas (8-bit) + readbackTex (rgba8unorm).
      const blitBg = device.createBindGroup({
        layout: this.blitBgl,
        entries: [
          { binding: 0, resource: curAccum.createView() },
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
      for (const t of tempTextures) t.destroy();
      for (const b of tempBuffers) b.destroy();
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
    this.resizeIntermediates(w, h);
    this.ctx.configure({ device: this.device, format: this.canvasFmt, alphaMode: "opaque" });
  }

  dispose(): void {
    this.readbackTex.destroy();
    this.fxPing.destroy();
    this.fxPong.destroy();
    this.fxScratch.destroy();
    this.accumA.destroy();
    this.accumB.destroy();
    this.device.destroy();
  }
}

export function readPixelFactory(renderer: FrameRenderer): ReadPixelFn {
  return (x, y) => renderer.readPixel(x, y);
}
