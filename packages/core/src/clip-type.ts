export type ClipType = "video" | "audio" | "image" | "text" | "lottie";

export function clipTypeIsVisual(t: ClipType): boolean {
  return t === "video" || t === "image" || t === "text" || t === "lottie";
}

export function clipTypesCompatible(a: ClipType, b: ClipType): boolean {
  return a === b || (clipTypeIsVisual(a) && clipTypeIsVisual(b));
}

export function clipTypeFromFileExtension(ext: string): ClipType | null {
  switch (ext.toLowerCase()) {
    case "mov":
    case "mp4":
    case "m4v":
      return "video";
    case "mp3":
    case "wav":
    case "aac":
    case "m4a":
      return "audio";
    case "png":
    case "jpg":
    case "jpeg":
    case "tiff":
    case "heic":
    case "webp":
      return "image";
    case "json":
    case "lottie":
      return "lottie";
    default:
      return null;
  }
}
