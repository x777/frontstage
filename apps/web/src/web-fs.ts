import type { ProjectStore } from "@palmier/core";
import type { MediaGateway } from "@palmier/core";

export function dirHandleProjectStore(dir: FileSystemDirectoryHandle): ProjectStore {
  return {
    async readText(name: string): Promise<string | null> {
      try {
        const fh = await dir.getFileHandle(name);
        return await (await fh.getFile()).text();
      } catch (e) {
        if ((e as DOMException).name === "NotFoundError") return null;
        throw e;
      }
    },
    async writeText(name: string, data: string): Promise<void> {
      const fh = await dir.getFileHandle(name, { create: true });
      const w = await fh.createWritable();
      await w.write(data);
      await w.close();
    },
  };
}

function parseMediaPath(relativePath: string): string {
  if (relativePath.includes("..")) throw new Error(`Invalid media path: ${relativePath}`);
  if (!relativePath.startsWith("media/")) throw new Error(`Media path must start with media/: ${relativePath}`);
  const file = relativePath.slice("media/".length);
  if (!file || file.includes("/")) throw new Error(`Invalid media path: ${relativePath}`);
  return file;
}

export class WebMediaGateway implements MediaGateway {
  constructor(private readonly dir: FileSystemDirectoryHandle) {}

  async writeMedia(relativePath: string, bytes: Uint8Array): Promise<void> {
    const file = parseMediaPath(relativePath);
    const mediaDir = await this.dir.getDirectoryHandle("media", { create: true });
    const fh = await mediaDir.getFileHandle(file, { create: true });
    const w = await fh.createWritable();
    await w.write(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
    await w.close();
  }

  async readMedia(relativePath: string): Promise<Uint8Array> {
    const file = parseMediaPath(relativePath);
    try {
      const mediaDir = await this.dir.getDirectoryHandle("media");
      const fh = await mediaDir.getFileHandle(file);
      return new Uint8Array(await (await fh.getFile()).arrayBuffer());
    } catch (e) {
      if ((e as DOMException).name === "NotFoundError") throw new Error("media not found: " + relativePath);
      throw e;
    }
  }

  async hasMedia(relativePath: string): Promise<boolean> {
    try {
      const file = parseMediaPath(relativePath);
      const mediaDir = await this.dir.getDirectoryHandle("media");
      await mediaDir.getFileHandle(file);
      return true;
    } catch (e) {
      if ((e as DOMException).name === "NotFoundError") return false;
      throw e;
    }
  }
}
