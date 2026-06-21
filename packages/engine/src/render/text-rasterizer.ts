import { type Size, type TextLayer, type RGBA } from "@palmier/core";

const css = (c: RGBA): string =>
  `rgba(${Math.round(c.r * 255)},${Math.round(c.g * 255)},${Math.round(c.b * 255)},${c.a})`;

export class TextRasterizer {
  private cache = new Map<string, VideoFrame>();

  rasterize(layer: TextLayer, renderSize: Size): VideoFrame {
    const key = JSON.stringify([layer.text, layer.style, renderSize]);
    const hit = this.cache.get(key);
    if (hit) return hit;

    const { width: W, height: H } = renderSize;
    const o = new OffscreenCanvas(W, H);
    const c = o.getContext("2d")!;
    const s = layer.style;
    // Always center the raster at canvas center; transform is applied at composite time.
    const cx = W / 2;
    const cy = H / 2;

    c.font = `${s.fontSize * s.fontScale}px ${s.fontName}`;
    c.textAlign = s.alignment;
    c.textBaseline = "middle";

    // background fill (behind text bounds)
    if (s.background.enabled) {
      const m = c.measureText(layer.text);
      const tw = m.width;
      const th = s.fontSize * s.fontScale;
      const bx =
        s.alignment === "center" ? cx - tw / 2 : s.alignment === "right" ? cx - tw : cx;
      c.fillStyle = css(s.background.color);
      c.fillRect(bx - 8, cy - th / 2 - 4, tw + 16, th + 8);
    }

    // shadow
    if (s.shadow.enabled) {
      c.shadowColor = css(s.shadow.color);
      c.shadowBlur = s.shadow.blur;
      c.shadowOffsetX = s.shadow.offsetX;
      c.shadowOffsetY = s.shadow.offsetY;
    }

    // border (stroke) then fill
    if (s.border.enabled) {
      c.lineWidth = 2;
      c.strokeStyle = css(s.border.color);
      c.strokeText(layer.text, cx, cy);
    }

    c.fillStyle = css(s.color);
    c.fillText(layer.text, cx, cy);

    const vf = new VideoFrame(o.transferToImageBitmap(), { timestamp: 0 });
    this.cache.set(key, vf);
    return vf;
  }

  dispose(): void {
    for (const f of this.cache.values()) f.close();
    this.cache.clear();
  }
}
