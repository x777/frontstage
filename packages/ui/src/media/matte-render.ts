import { rgbaFromHex } from "@frontstage/core";

// Ported from Swift Models/Matte.swift's Matte.png — a solid fill at FULL alpha (alpha hex chars,
// if present, are parsed but ignored for the fill) rasterized to PNG bytes via canvas.
const RENDER_FAILED = "Couldn't render matte image.";

function decodeBase64(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export async function renderMattePng(hexRGB: string, width: number, height: number): Promise<Uint8Array> {
  const rgba = rgbaFromHex(hexRGB);
  if (!rgba) throw new Error(RENDER_FAILED);

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error(RENDER_FAILED);

  const r = Math.round(rgba.r * 255);
  const g = Math.round(rgba.g * 255);
  const b = Math.round(rgba.b * 255);
  ctx.fillStyle = `rgb(${r}, ${g}, ${b})`;
  ctx.fillRect(0, 0, width, height);

  const dataUrl = canvas.toDataURL("image/png");
  const comma = dataUrl.indexOf(",");
  if (comma < 0) throw new Error(RENDER_FAILED);
  return decodeBase64(dataUrl.slice(comma + 1));
}
