export type ClipType = "video" | "audio" | "image" | "text" | "lottie" | "subtitle" | "sequence";

export function clipTypeIsVisual(t: ClipType): boolean {
  return t === "video" || t === "image" || t === "text" || t === "lottie" || t === "sequence";
}

/** Palmier `placeClip`: video and nested timelines can carry a linked audio partner. */
export function clipTypeCanLinkAudio(t: ClipType): boolean {
  return t === "video" || t === "sequence";
}

export function clipTypesCompatible(a: ClipType, b: ClipType): boolean {
  return a === b || (clipTypeIsVisual(a) && clipTypeIsVisual(b));
}

/** Palmier: subtitle assets are not placeable via add_clips — use add_captions subtitleMediaRef. */
export function subtitleNotPlaceableMessage(id: string): string {
  return `'${id}' is a subtitle file and can't be placed as a clip. Use add_captions with subtitleMediaRef to place its cues as captions.`;
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
    case "srt":
    case "vtt":
      return "subtitle";
    default:
      return null;
  }
}
