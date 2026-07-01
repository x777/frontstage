import type { Effect } from "../color/effect.js";
import type { Clip } from "../clip.js";
import type { Timeline } from "../timeline.js";
import type { Command } from "./editor-store.js";
import { replaceClip } from "./timeline-commands.js";
import type { BlendMode } from "../color/blend-mode.js";
import { effectDescriptor, canonicalIndex, clampParam, defaultEffect } from "../color/effect-registry.js";

function isEffectNeutral(effect: Effect): boolean {
  const d = effectDescriptor(effect.type);
  if (!d) return false;
  for (const spec of d.params) {
    const v = effect.params[spec.key]?.value ?? spec.default;
    if (v !== spec.default) return false;
  }
  for (const sk of d.stringParams ?? []) {
    if ((effect.params[sk]?.string ?? "") !== "") return false;
  }
  return true;
}

function insertCanonical(stack: Effect[], effect: Effect): Effect[] {
  const at = stack.findIndex((e) => canonicalIndex(e.type) > canonicalIndex(effect.type));
  if (at === -1) stack.push(effect);
  else stack.splice(at, 0, effect);
  return stack;
}

function upsert(effects: Effect[] | undefined, type: string, newId: () => string, patch: (e: Effect) => Effect): Effect[] {
  const stack = [...(effects ?? [])];
  const idx = stack.findIndex((e) => e.type === type);
  let effect: Effect;
  if (idx >= 0) {
    effect = patch(stack[idx]!);
    stack.splice(idx, 1);
  } else {
    const base = defaultEffect(type, newId);
    if (!base) return stack; // unknown type: no-op
    effect = patch(base);
  }
  if (isEffectNeutral(effect)) return stack; // pruned (already removed if it existed)
  return insertCanonical(stack, effect);
}

export function setEffectParam(effects: Effect[] | undefined, type: string, key: string, value: number, newId: () => string): Effect[] {
  const clamped = clampParam(type, key, value);
  return upsert(effects, type, newId, (e) => ({ ...e, params: { ...e.params, [key]: { ...e.params[key], value: clamped } } }));
}

export function setEffectString(effects: Effect[] | undefined, type: string, key: string, str: string, newId: () => string): Effect[] {
  return upsert(effects, type, newId, (e) => ({ ...e, params: { ...e.params, [key]: { ...e.params[key], string: str } } }));
}

export function setSectionEnabled(effects: Effect[] | undefined, types: string[], enabled: boolean): Effect[] {
  return (effects ?? []).map((e) => (types.includes(e.type) ? { ...e, enabled } : e));
}

export function resetSection(effects: Effect[] | undefined, types: string[]): Effect[] {
  return (effects ?? []).filter((e) => !types.includes(e.type));
}

export function sharedParamValue(clips: Clip[], type: string, key: string): number | null {
  const def = effectDescriptor(type)?.params.find((p) => p.key === key)?.default ?? 0;
  if (clips.length === 0) return def;
  const vals = clips.map((c) => c.effects?.find((e) => e.type === type)?.params[key]?.value ?? def);
  const first = vals[0]!;
  return vals.every((v) => v === first) ? first : null;
}

const PARAM_LABELS: Record<string, string> = {
  "color.exposure:ev": "Exposure",
  "color.contrast:amount": "Contrast",
  "color.highlightsShadows:highlights": "Highlights",
  "color.highlightsShadows:shadows": "Shadows",
  "color.blacksWhites:blacks": "Blacks",
  "color.blacksWhites:whites": "Whites",
  "color.temperature:temperature": "Temperature",
  "color.temperature:tint": "Tint",
  "color.vibrance:amount": "Vibrance",
  "color.saturation:amount": "Saturation",
  "color.lut:intensity": "Intensity",
  "blur.sharpen:amount": "Sharpen",
  "blur.noiseReduction:amount": "Noise Reduction",
  "detail.clarity:clarity": "Clarity",
  "detail.clarity:dehaze": "Dehaze",
  "blur.gaussian:radius": "Radius",
  "blur.motion:radius": "Radius",
  "blur.motion:angle": "Angle",
  "stylize.vignette:amount": "Amount",
  "stylize.vignette:midpoint": "Midpoint",
  "stylize.vignette:roundness": "Roundness",
  "stylize.vignette:feather": "Feather",
  "stylize.grain:amount": "Amount",
  "stylize.grain:size": "Size",
  "stylize.glow:intensity": "Intensity",
  "stylize.glow:radius": "Radius",
  "stylize.glow:threshold": "Threshold",
  "stylize.glow:warmth": "Warmth",
  "key.chroma:keyHue": "Key Hue",
  "key.chroma:tolerance": "Tolerance",
  "key.chroma:softness": "Softness",
  "key.chroma:spill": "Spill",
};

export function effectParamLabel(type: string, key: string): string {
  return PARAM_LABELS[`${type}:${key}`] ?? key;
}

export function setClipEffectsCommand(clipIds: string[], effectsFor: (clip: Clip) => Effect[], coalesceKey?: string): Command {
  return {
    label: "Adjust",
    coalesceKey,
    apply: (tl: Timeline) =>
      clipIds.reduce((t, id) => replaceClip(t, id, (c) => {
        const next = effectsFor(c);
        return { ...c, effects: next.length ? next : undefined };
      }), tl),
  };
}

export function setClipBlendModeCommand(clipIds: string[], mode: BlendMode | undefined): Command {
  return {
    label: "Blend Mode",
    apply: (tl: Timeline) => clipIds.reduce((t, id) => replaceClip(t, id, (c) => ({ ...c, blendMode: mode })), tl),
  };
}
