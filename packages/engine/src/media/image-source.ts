import type { Size } from "@palmier/core";

export class ImageSource {
  private constructor(private vf: VideoFrame, private _size: Size) {}

  static async create(bytes: ArrayBuffer): Promise<ImageSource> {
    const bmp = await createImageBitmap(new Blob([bytes]));
    const size = { width: bmp.width, height: bmp.height };
    const vf = new VideoFrame(bmp, { timestamp: 0 });
    bmp.close();
    return new ImageSource(vf, size);
  }

  frame(): VideoFrame { return this.vf; }
  size(): Size { return this._size; }
  dispose(): void { this.vf.close(); }
}
